/**
 * "Kadou24h Team" messages to many people at once (client request, 2026-10-29): an admin
 * writes once to every approved vendor, rider and/or worker. Each person gets the same
 * in-app team message (badge, every role's list); the phone push follows their
 * "account alerts" setting. Sending runs in the background, 200 people at a time, and
 * picks up where it stopped after a restart (who already has it is read from the
 * notifications themselves).
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import AppError from "../../errorHelpers/AppError";
import { logger } from "../../utils/logger";
import { sendPushToTokens } from "../../utils/pushNotification";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { DeviceToken } from "../device_token/device_token.model";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { ApprovalStatus } from "../profile_common/profile.common";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { UserStatus } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { NotificationType } from "./notification.interface";
import { Notification } from "./notification.model";
import { BroadcastAudience, BroadcastStatus, TeamBroadcast } from "./team_broadcast.model";

const CHUNK = 200;
const LEASE_MS = 2 * 60 * 1000;

const approvedUserIds = (audience: BroadcastAudience): Promise<Types.ObjectId[]> => {
  const approved = { approvalStatus: ApprovalStatus.approved };
  if (audience === BroadcastAudience.vendors) return VendorProfile.distinct("userId", approved);
  if (audience === BroadcastAudience.riders) return RiderProfile.distinct("userId", approved);
  return ProfessionalProfile.distinct("userId", approved);
};

/** Everyone in these audiences, once each, whose account still works (not deleted or banned) */
const recipientsOf = async (audiences: BroadcastAudience[]): Promise<Types.ObjectId[]> => {
  const ids = (await Promise.all(audiences.map(approvedUserIds))).flat();
  return User.distinct("_id", { _id: { $in: ids }, isDeleted: { $ne: true }, status: { $ne: UserStatus.banned } });
};

/** How many people each audience reaches, and the chosen ones together (someone can be in two) */
const getAudienceCounts = async (audiences: BroadcastAudience[]) => {
  const all = Object.values(BroadcastAudience);
  const [each, total] = await Promise.all([
    Promise.all(all.map(async (a) => [a, (await recipientsOf([a])).length] as const)),
    audiences.length ? recipientsOf(audiences).then((ids) => ids.length) : 0,
  ]);
  return { ...Object.fromEntries(each), total };
};

/** Sends what is left of a broadcast. Only one server at a time holds it (lease). */
const run = async (broadcastId: Types.ObjectId) => {
  const now = new Date();
  const broadcast = await TeamBroadcast.findOneAndUpdate(
    { _id: broadcastId, status: BroadcastStatus.sending, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lt: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) } },
    { returnDocument: "after" },
  );
  if (!broadcast) return;

  const id = String(broadcast._id);
  try {
    const everyone = await recipientsOf(broadcast.audiences);
    const already = new Set((await Notification.distinct("userId", { "data.broadcastId": id })).map(String));
    const todo = everyone.filter((userId) => !already.has(String(userId)));
    // The team writes once; the same words show in both languages
    const text = { title: { fr: broadcast.title, en: broadcast.title }, body: { fr: broadcast.message, en: broadcast.message } };
    const data = { kind: "team", broadcastId: id };

    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      const created = await Notification.insertMany(
        chunk.map((userId) => ({ userId, type: NotificationType.team_message, ...text, data, isRead: false })),
      );
      for (const notification of created) emitToUser(String(notification.userId), "new_notification", notification);

      // Phone push only for people who keep "account alerts" on
      const wanting = await User.find({ _id: { $in: chunk }, "notificationPrefs.accountAlerts": { $ne: false } }).select("_id").lean();
      const devices = await DeviceToken.find({ userId: { $in: wanting.map((u) => u._id) } }).select("token").lean();
      const push = await sendPushToTokens(
        devices.map((d) => d.token),
        { title: broadcast.title, body: broadcast.message, data: { type: NotificationType.team_message, ...data } },
      );

      await TeamBroadcast.updateOne(
        { _id: broadcast._id },
        { $inc: { delivered: created.length, pushed: push.sent }, $set: { lockedUntil: new Date(Date.now() + LEASE_MS) } },
      );
    }

    await TeamBroadcast.updateOne(
      { _id: broadcast._id },
      { $set: { status: BroadcastStatus.sent, finishedAt: new Date() }, $unset: { lockedUntil: 1 } },
    );
  } catch (error) {
    logger.error("Team broadcast stopped; it resumes at the next start", { broadcastId: id, error: error instanceof Error ? error.message : error });
    await TeamBroadcast.updateOne({ _id: broadcast._id }, { $unset: { lockedUntil: 1 } }).catch(() => undefined);
  }
};

const createBroadcast = async (adminId: string, payload: { title: string; message: string; audiences: BroadcastAudience[] }) => {
  const audiences = [...new Set(payload.audiences)];
  const recipients = (await recipientsOf(audiences)).length;
  if (!recipients) throw new AppError(httpStatus.BAD_REQUEST, "BROADCAST_NO_RECIPIENTS");

  const broadcast = await TeamBroadcast.create({
    title: payload.title,
    message: payload.message,
    audiences,
    sentBy: new Types.ObjectId(adminId),
    recipients,
  });
  await AuditLogServices.record({
    actorId: adminId,
    action: "notification.broadcast",
    targetType: "broadcast",
    targetId: String(broadcast._id),
    after: { title: payload.title, body: payload.message, audiences, recipients },
  });
  void run(broadcast._id);
  return broadcast;
};

/** Sends that stopped (server restart) carry on; called at start-up */
const resumeUnfinished = async () => {
  const unfinished = await TeamBroadcast.find({ status: BroadcastStatus.sending }).select("_id").lean();
  for (const { _id } of unfinished) void run(_id);
  return unfinished.length;
};

/** Past broadcasts, newest first, with how many people read them (notifications are kept 90 days) */
const getBroadcasts = async (query: { page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const [rows, total] = await Promise.all([
    TeamBroadcast.find().select("-lockedUntil").populate("sentBy", "name").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    TeamBroadcast.countDocuments(),
  ]);
  const read = await Promise.all(rows.map((b) => Notification.countDocuments({ "data.broadcastId": String(b._id), isRead: true })));
  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: rows.map((b, i) => ({ ...b, read: read[i] })),
  };
};

export const TeamBroadcastServices = {
  getAudienceCounts,
  createBroadcast,
  resumeUnfinished,
  getBroadcasts,
};

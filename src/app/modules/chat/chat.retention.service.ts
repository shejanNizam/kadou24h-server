/**
 * Chat retention (client, 2026-11-22): messages older than `settings.chat.retentionDays`
 * (default 90, admin 30–730) are deleted with their photos and voice notes, and a chat with
 * nothing left goes too. What may still be needed as proof stays:
 * - a chat with a report the team hasn't handled,
 * - messages about an order still going, or with an open dispute or a pending refund,
 * - a moto-taxi chat while the ride is going on.
 * Runs every few hours; each run looks at every chat that has old messages once.
 */
import { Types } from "mongoose";
import { deleteFromCloudinary } from "../../config/cloudinary.config";
import { logger } from "../../utils/logger";
import { Notification } from "../notification/notification.model";
import { SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { DisputeStatus, RefundStatus } from "../payment/payment.interface";
import { Dispute } from "../payment/dispute.model";
import { Refund } from "../payment/refund.model";
import { ReportStatus } from "../report/report.interface";
import { Report } from "../report/report.model";
import { RideStatus } from "../ride/ride.interface";
import { Ride } from "../ride/ride.model";
import { SettingsServices } from "../settings/settings.service";
import { ConversationType, MessageType } from "./chat.interface";
import { Conversation } from "./conversation.model";
import { Message } from "./message.model";

const DAY = 24 * 60 * 60 * 1000;
export const RETENTION = {
  defaultDays: 90,
  sweepEveryMs: Number(process.env.CHAT_RETENTION_SWEEP_MS) || 6 * 60 * 60 * 1000,
};

const RIDE_GOING = [RideStatus.searching, RideStatus.accepted, RideStatus.arrived, RideStatus.in_progress];
const ORDER_DONE = [SubOrderStatus.delivered, SubOrderStatus.cancelled];

const ids = (values: unknown[]) => new Set(values.filter(Boolean).map(String));

/** Orders whose messages are still proof: going on, disputed, or waiting for a refund */
const ordersToKeep = async () => {
  const [going, disputes, refunds] = await Promise.all([
    SubOrder.distinct("_id", { status: { $nin: ORDER_DONE } }),
    Dispute.find({ status: DisputeStatus.open }).select("orderId subOrderId").lean(),
    Refund.find({ status: RefundStatus.pending }).select("orderId subOrderId").lean(),
  ]);
  const held = [...disputes, ...refunds];
  return {
    subOrders: ids([...going, ...held.map((h) => h.subOrderId)]),
    // A dispute or refund on the whole order holds every store's part of it
    orders: ids(held.filter((h) => !h.subOrderId).map((h) => h.orderId)),
  };
};

type Outcome = "kept" | "trimmed" | "deleted";

/** Clean one chat: nothing to delete (kept), old messages deleted (trimmed), or the whole chat gone */
const cleanConversation = async (
  conversationId: Types.ObjectId,
  cutoff: Date,
  keep: Awaited<ReturnType<typeof ordersToKeep>>,
  reported: Set<string>,
): Promise<Outcome> => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    // Messages left behind by a chat that no longer exists
    await Message.deleteMany({ conversationId });
    return "deleted";
  }
  if (reported.has(String(conversation._id))) return "kept";
  if (conversation.type === ConversationType.ride && conversation.rideId && (await Ride.exists({ _id: conversation.rideId, status: { $in: RIDE_GOING } }))) {
    return "kept";
  }
  const orderHeld = (subOrderId?: Types.ObjectId | null, orderId?: Types.ObjectId | null) =>
    Boolean(subOrderId && keep.subOrders.has(String(subOrderId))) || Boolean(orderId && keep.orders.has(String(orderId)));
  if (conversation.type === ConversationType.order && orderHeld(conversation.subOrderId, conversation.orderId)) return "kept";

  const old = await Message.find({ conversationId, createdAt: { $lt: cutoff } })
    .select("_id type mediaUrl subOrderId")
    .lean();
  // Store chat: the messages about an order still held stay (by store part, or the whole order)
  const tagged = [...ids(old.map((m) => m.subOrderId))];
  const orderOf = new Map(
    tagged.length && keep.orders.size
      ? (await SubOrder.find({ _id: { $in: tagged } }).select("orderId").lean()).map((s) => [String(s._id), s.orderId] as const)
      : [],
  );
  const gone = old.filter((m) => !m.subOrderId || !orderHeld(m.subOrderId, orderOf.get(String(m.subOrderId))));
  if (!gone.length) return "kept";
  await Message.deleteMany({ _id: { $in: gone.map((m) => m._id) } });

  // Their photos and voice notes go too (a failure is logged, never blocks the clean-up)
  const media = gone.filter((m) => m.mediaUrl && m.type !== MessageType.text).map((m) => m.mediaUrl!);
  await Promise.all(
    media.map((url) =>
      deleteFromCloudinary(url).catch((error) => logger.warn("Chat media not deleted", { url, error: error instanceof Error ? error.message : error })),
    ),
  );

  const left = await Message.find({ conversationId }).sort({ createdAt: -1 }).select("senderId type text createdAt subOrderNumber").lean();
  if (!left.length) {
    await Conversation.deleteOne({ _id: conversation._id });
    await Notification.deleteMany({ "data.conversationId": String(conversation._id) });
    return "deleted";
  }
  // The preview and unread counts only speak of what is left
  const newest = left[0]!;
  conversation.lastMessage = {
    text: newest.text,
    type: newest.type,
    senderId: newest.senderId ?? undefined,
    at: newest.createdAt ?? new Date(),
    ...(newest.subOrderNumber && { subOrderNumber: newest.subOrderNumber }),
  };
  for (const p of conversation.participants) {
    const fromOthers = left.filter((m) => m.senderId && String(m.senderId) !== String(p.userId)).length;
    p.unreadCount = Math.min(p.unreadCount ?? 0, fromOthers);
  }
  await conversation.save({ timestamps: false });
  return "trimmed";
};

/** One clean-up run; returns what was deleted */
const sweep = async (now = Date.now()) => {
  const days = (await SettingsServices.getSettings()).chat?.retentionDays ?? RETENTION.defaultDays;
  const cutoff = new Date(now - days * DAY);
  const chats: Types.ObjectId[] = await Message.distinct("conversationId", { createdAt: { $lt: cutoff } });
  if (!chats.length) return { trimmed: 0, deleted: 0, days };
  const [keep, reports] = await Promise.all([
    ordersToKeep(),
    Report.distinct("conversationId", { status: ReportStatus.pending, conversationId: { $exists: true } }),
  ]);
  const reported = ids(reports);
  const count = { trimmed: 0, deleted: 0 };
  for (const id of chats) {
    try {
      const outcome = await cleanConversation(id, cutoff, keep, reported);
      if (outcome !== "kept") count[outcome] += 1;
    } catch (error) {
      logger.error("Chat retention failed for a chat", { conversationId: String(id), error: error instanceof Error ? error.message : error });
    }
  }
  return { ...count, days };
};

const startRetentionSweep = () => {
  const run = () =>
    sweep()
      .then((r) => (r.trimmed || r.deleted) && logger.info(`Chat retention (${r.days} days): ${r.trimmed} chat(s) trimmed, ${r.deleted} deleted`))
      .catch((error) => logger.error("Chat retention sweep failed", { error: error instanceof Error ? error.message : error }));
  void run();
  const timer = setInterval(run, RETENTION.sweepEveryMs);
  timer.unref();
  return timer;
};

export const ChatRetentionServices = { sweep, startRetentionSweep };

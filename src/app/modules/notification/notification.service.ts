import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import AppError from "../../errorHelpers/AppError";
import { INotification, ILocalizedMessage, NotificationType } from "./notification.interface";
import { Notification } from "./notification.model";
import { logger } from "../../utils/logger";
import { sendPushToUser } from "../../utils/pushNotification";
import { INotificationPrefs, Language } from "../user/user.interface";
import { User } from "../user/user.model";
import httpStatus from "http-status";
import { AuditLogServices } from "../audit_log/audit_log.service";

// A role's list also shows the account-wide notifications (no mode: warnings, suspension, team messages)
const modeFilter = (mode: string) => ({ $or: [{ mode }, { mode: { $exists: false } }, { mode: null }] });

export interface ICreateNotificationPayload {
  userId: string | Types.ObjectId;
  mode?: string;
  type: NotificationType;
  title: ILocalizedMessage;
  body: ILocalizedMessage;
  data?: Record<string, unknown>;
}

const createNotification = async (
  payload: ICreateNotificationPayload,
): Promise<INotification> => {
  const notification = await Notification.create({
    userId: new Types.ObjectId(payload.userId.toString()),
    mode: payload.mode,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
    isRead: false,
  });

  // Real-time socket push (app open)
  emitToUser(payload.userId.toString(), "new_notification", notification);

  // Phone push (app closed) — respects the user's notification preferences
  void sendPhonePush(payload);

  return notification;
};

// Which "Notifications" settings toggle controls each notification type
const PREF_BY_TYPE: Record<NotificationType, keyof INotificationPrefs> = {
  [NotificationType.order_placed]: "orderUpdates",
  [NotificationType.order_accepted]: "orderUpdates",
  [NotificationType.order_delivered]: "orderUpdates",
  [NotificationType.order_cancelled]: "orderUpdates",
  [NotificationType.ready_for_pickup]: "orderUpdates",
  [NotificationType.feedback_request]: "orderUpdates",
  [NotificationType.refund_update]: "orderUpdates",
  // Worker bookings are service orders
  [NotificationType.booking_update]: "orderUpdates",
  // Moto-taxi rides: passenger and rider
  [NotificationType.ride_update]: "deliveryUpdates",
  [NotificationType.rider_on_the_way]: "deliveryUpdates",
  [NotificationType.new_delivery_assigned]: "deliveryUpdates",
  [NotificationType.collect_payment]: "deliveryUpdates",
  [NotificationType.new_message]: "messages",
  [NotificationType.special_offer]: "offers",
  [NotificationType.application_update]: "jobPosts",
  [NotificationType.job_update]: "accountAlerts",
  [NotificationType.earnings_updated]: "accountAlerts",
  [NotificationType.withdrawal_update]: "accountAlerts",
  [NotificationType.profile_approved]: "accountAlerts",
  [NotificationType.moderation_warning]: "accountAlerts",
  [NotificationType.account_suspended]: "accountAlerts",
  [NotificationType.system_alert]: "accountAlerts",
  [NotificationType.team_message]: "accountAlerts",
};

// Safety-critical types are always pushed, whatever the preference
const ALWAYS_PUSH = new Set([
  NotificationType.account_suspended,
  NotificationType.moderation_warning,
  NotificationType.team_message,
  NotificationType.job_update,
]);

const sendPhonePush = async (payload: ICreateNotificationPayload) => {
  try {
    const user = await User.findById(payload.userId).select("language notificationPrefs").lean();
    if (!user) return;

    const pref = PREF_BY_TYPE[payload.type];
    if (!ALWAYS_PUSH.has(payload.type) && user.notificationPrefs?.[pref] === false) return;

    const lang = user.language === Language.en ? "en" : "fr";
    await sendPushToUser(payload.userId, {
      title: payload.title[lang],
      body: payload.body[lang],
      data: { type: payload.type, mode: payload.mode, ...payload.data },
    });
  } catch (error) {
    logger.error("Failed to send phone push", {
      type: payload.type,
      error: error instanceof Error ? error.message : error,
    });
  }
};

const getMyNotifications = async (
  userId: string,
  query: {
    mode?: string;
    isRead?: boolean;
    page?: number;
    limit?: number;
  },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
  };

  if (query.mode) Object.assign(filter, modeFilter(query.mode));

  if (query.isRead !== undefined) {
    filter.isRead = String(query.isRead) === "true";
  }

  const [data, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({
      userId: new Types.ObjectId(userId),
      ...(query.mode ? modeFilter(query.mode) : {}),
      isRead: false,
    }),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
      unreadCount,
    },
    data,
  };
};

const markAsRead = async (userId: string, notificationId: string): Promise<INotification> => {
  const notification = await Notification.findOne({
    _id: notificationId,
    userId: new Types.ObjectId(userId),
  });

  if (!notification) {
    throw new AppError(404, "NOTIFICATION_NOT_FOUND");
  }

  notification.isRead = true;
  await notification.save();

  return notification;
};

const markAllAsRead = async (userId: string, mode?: string) => {
  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    isRead: false,
  };
  if (mode) Object.assign(filter, modeFilter(mode));

  const result = await Notification.updateMany(filter, { $set: { isRead: true } });
  return { modifiedCount: result.modifiedCount };
};

/** The user deletes one of their notifications (client, 2026-10-30) */
const deleteNotification = async (userId: string, notificationId: string) => {
  const result = Types.ObjectId.isValid(notificationId)
    ? await Notification.deleteOne({ _id: notificationId, userId: new Types.ObjectId(userId) })
    : { deletedCount: 0 };
  if (!result.deletedCount) throw new AppError(httpStatus.NOT_FOUND, "NOTIFICATION_NOT_FOUND");
};

/** "Delete all" in one mode's list (with the account-wide ones that list shows) */
const deleteAllNotifications = async (userId: string, mode?: string) => {
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (mode) Object.assign(filter, modeFilter(mode));
  const result = await Notification.deleteMany(filter);
  return { deletedCount: result.deletedCount };
};

const getUnreadCount = async (userId: string, mode?: string) => {
  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    isRead: false,
  };
  if (mode) Object.assign(filter, modeFilter(mode));

  const count = await Notification.countDocuments(filter);
  return { unreadCount: count };
};

/**
 * The Kadou24h team writes to one user (one way: they answer through support or WhatsApp).
 * No mode, so it shows in every role's list; always pushed; audit-logged.
 */
const sendTeamMessage = async (adminId: string, payload: { userId: string; title: string; body: string }) => {
  if (!Types.ObjectId.isValid(payload.userId)) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
  const user = await User.findOne({ _id: payload.userId, isDeleted: { $ne: true } }).select("_id").lean();
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
  const notification = await createNotification({
    userId: user._id,
    type: NotificationType.team_message,
    // The team writes once; the same words show in both languages
    title: { fr: payload.title, en: payload.title },
    body: { fr: payload.body, en: payload.body },
    data: { kind: "team" },
  });
  await AuditLogServices.record({
    actorId: adminId,
    action: "notification.team_message",
    targetType: "user",
    targetId: String(user._id),
    after: { title: payload.title, body: payload.body },
  });
  return notification;
};

/** Team messages already sent to a user (newest first) */
const getTeamMessages = async (userId: string) => {
  if (!Types.ObjectId.isValid(userId)) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
  return Notification.find({ userId: new Types.ObjectId(userId), type: NotificationType.team_message })
    .select("title body isRead createdAt")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
};

export const NotificationServices = {
  sendTeamMessage,
  getTeamMessages,
  createNotification,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  getUnreadCount,
};

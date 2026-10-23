import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import AppError from "../../errorHelpers/AppError";
import { INotification, ILocalizedMessage, NotificationType } from "./notification.interface";
import { Notification } from "./notification.model";
import { logger } from "../../utils/logger";
import { sendPushToUser } from "../../utils/pushNotification";
import { INotificationPrefs, Language } from "../user/user.interface";
import { User } from "../user/user.model";

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
  [NotificationType.earnings_updated]: "accountAlerts",
  [NotificationType.withdrawal_update]: "accountAlerts",
  [NotificationType.profile_approved]: "accountAlerts",
  [NotificationType.moderation_warning]: "accountAlerts",
  [NotificationType.account_suspended]: "accountAlerts",
  [NotificationType.system_alert]: "accountAlerts",
};

// Safety-critical types are always pushed, whatever the preference
const ALWAYS_PUSH = new Set([NotificationType.account_suspended, NotificationType.moderation_warning]);

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

  if (query.mode) {
    filter.mode = query.mode;
  }

  if (query.isRead !== undefined) {
    filter.isRead = String(query.isRead) === "true";
  }

  const [data, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({
      userId: new Types.ObjectId(userId),
      ...(query.mode ? { mode: query.mode } : {}),
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
    throw new AppError(404, "Notification not found");
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
  if (mode) {
    filter.mode = mode;
  }

  const result = await Notification.updateMany(filter, { $set: { isRead: true } });
  return { modifiedCount: result.modifiedCount };
};

const getUnreadCount = async (userId: string, mode?: string) => {
  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    isRead: false,
  };
  if (mode) {
    filter.mode = mode;
  }

  const count = await Notification.countDocuments(filter);
  return { unreadCount: count };
};

export const NotificationServices = {
  createNotification,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
};

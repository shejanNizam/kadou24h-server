import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import AppError from "../../errorHelpers/AppError";
import { INotification, ILocalizedMessage, NotificationType } from "./notification.interface";
import { Notification } from "./notification.model";

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

  // Real-time socket push
  emitToUser(payload.userId.toString(), "new_notification", notification);

  return notification;
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

import { model, Schema } from "mongoose";
import { INotification, NotificationType } from "./notification.interface";

const localizedMessageSchema = new Schema(
  {
    fr: { type: String, required: true },
    en: { type: String, required: true },
  },
  { _id: false },
);

export const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    mode: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: Object.values(NotificationType),
      required: true,
    },
    title: {
      type: localizedMessageSchema,
      required: true,
    },
    body: {
      type: localizedMessageSchema,
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 90 * 24 * 60 * 60, // 90 days TTL auto-expiry
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, mode: 1, createdAt: -1 });
// Team broadcasts: who already has it (resume) and how many read it
notificationSchema.index(
  { "data.broadcastId": 1, isRead: 1 },
  { partialFilterExpression: { "data.broadcastId": { $exists: true } } },
);

export const Notification = model<INotification>("Notification", notificationSchema);

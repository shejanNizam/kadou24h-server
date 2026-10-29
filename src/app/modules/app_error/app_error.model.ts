import { model, Schema } from "mongoose";
import { IAppError } from "./app_error.interface";

const appErrorSchema = new Schema<IAppError>(
  {
    message: { type: String, required: true },
    stack: { type: String },
    fatal: { type: Boolean, default: false },
    screen: { type: String },
    platform: { type: String },
    osVersion: { type: String },
    device: { type: String },
    appVersion: { type: String },
    updateId: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 }, // 30 days TTL auto-expiry
  },
  { versionKey: false },
);

appErrorSchema.index({ fatal: 1, createdAt: -1 });

export const AppErrorReport = model<IAppError>("AppErrorReport", appErrorSchema);

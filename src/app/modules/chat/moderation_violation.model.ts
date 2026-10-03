import { model, Schema } from "mongoose";
import {
  IModerationViolation,
  ModerationAction,
  ModerationRule,
} from "./chat.interface";

export const moderationViolationSchema = new Schema<IModerationViolation>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
    rule: {
      type: String,
      enum: Object.values(ModerationRule),
      required: true,
    },
    snippet: {
      type: String,
      trim: true,
    },
    action: {
      type: String,
      enum: Object.values(ModerationAction),
      required: true,
    },
    actionBy: {
      type: String,
      default: "system",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

moderationViolationSchema.index({ userId: 1, createdAt: -1 });

export const ModerationViolation = model<IModerationViolation>(
  "ModerationViolation",
  moderationViolationSchema,
);

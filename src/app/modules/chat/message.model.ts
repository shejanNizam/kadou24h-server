import { model, Schema } from "mongoose";
import { IMessage, MessageType, ModerationStatus } from "./chat.interface";

export const messageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null, // null for automated system messages
    },
    type: {
      type: String,
      enum: Object.values(MessageType),
      default: MessageType.text,
      required: true,
    },
    text: {
      type: String,
      trim: true,
    },
    mediaUrl: {
      type: String,
      trim: true,
    },
    mediaDurationSec: {
      type: Number,
      min: 0,
    },
    moderationStatus: {
      type: String,
      enum: Object.values(ModerationStatus),
      default: ModerationStatus.clean,
      required: true,
    },
    moderationRules: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, createdAt: -1 });

export const Message = model<IMessage>("Message", messageSchema);

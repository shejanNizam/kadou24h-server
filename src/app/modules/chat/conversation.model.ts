import { model, Schema } from "mongoose";
import { AppMode } from "../user/user.interface";
import {
  ConversationType,
  IConversation,
  ILastMessage,
  IParticipant,
  MessageType,
} from "./chat.interface";

const participantSchema = new Schema<IParticipant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    mode: { type: String, enum: Object.values(AppMode), required: true },
    unreadCount: { type: Number, default: 0, min: 0 },
    lastReadAt: { type: Date },
  },
  { _id: true },
);

const lastMessageSchema = new Schema<ILastMessage>(
  {
    text: { type: String },
    type: { type: String, enum: Object.values(MessageType), default: MessageType.text },
    senderId: { type: Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

export const conversationSchema = new Schema<IConversation>(
  {
    type: {
      type: String,
      enum: Object.values(ConversationType),
      required: true,
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    subOrderId: { type: Schema.Types.ObjectId, ref: "SubOrder" },
    applicationId: { type: Schema.Types.ObjectId, ref: "JobApplication" },
    workerProfileId: { type: Schema.Types.ObjectId, ref: "ProfessionalProfile" },
    allowVoice: { type: Boolean, default: false },
    participants: {
      type: [participantSchema],
      required: true,
      validate: {
        validator: (v: IParticipant[]) => Array.isArray(v) && v.length >= 2,
        message: "A conversation must have at least 2 participants.",
      },
    },
    lastMessage: { type: lastMessageSchema },
  },
  {
    timestamps: true,
  },
);

conversationSchema.index({ subOrderId: 1 });
conversationSchema.index({ applicationId: 1 });
conversationSchema.index({ "participants.userId": 1, "participants.mode": 1 });
conversationSchema.index({ updatedAt: -1 });

export const Conversation = model<IConversation>("Conversation", conversationSchema);

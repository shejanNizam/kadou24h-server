import { model, Schema } from "mongoose";
import { AppMode } from "../user/user.interface";
import {
  AssistantConversationStatus,
  AssistantRole,
  IAssistantConversation,
  IAssistantMessage,
} from "./ai_assistant.interface";

/** The last messages kept per conversation (older ones are dropped) */
export const ASSISTANT_MAX_STORED_MESSAGES = 60;

const messageSchema = new Schema<IAssistantMessage>({
  role: { type: String, enum: Object.values(AssistantRole), required: true },
  text: { type: String, required: true, maxlength: 4000 },
  needsHuman: { type: Boolean },
  createdAt: { type: Date, default: Date.now },
});

const assistantConversationSchema = new Schema<IAssistantConversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    mode: { type: String, enum: Object.values(AppMode), required: true },
    status: {
      type: String,
      enum: Object.values(AssistantConversationStatus),
      default: AssistantConversationStatus.active,
      required: true,
    },
    messages: { type: [messageSchema], default: [] },
    ticketId: { type: Schema.Types.ObjectId, ref: "SupportTicket" },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

// One active conversation per person (two taps at once must not open two)
assistantConversationSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: AssistantConversationStatus.active } },
);
assistantConversationSchema.index({ userId: 1, createdAt: -1 });
assistantConversationSchema.index({ createdAt: -1 });

export const AssistantConversation = model<IAssistantConversation>("assistant_conversations", assistantConversationSchema);

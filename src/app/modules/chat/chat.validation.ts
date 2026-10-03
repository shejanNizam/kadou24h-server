import { z } from "zod";
import { AppMode } from "../user/user.interface";
import { ConversationType, MessageType } from "./chat.interface";

const startConversationZodSchema = z.object({
  body: z.object({
    recipientId: z.string().min(1, "Recipient ID is required"),
    recipientMode: z.nativeEnum(AppMode),
    myMode: z.nativeEnum(AppMode),
    type: z.nativeEnum(ConversationType),
    orderId: z.string().optional(),
    subOrderId: z.string().optional(),
    applicationId: z.string().optional(),
    workerProfileId: z.string().optional(),
  }),
});

const sendMessageZodSchema = z.object({
  body: z
    .object({
      type: z.nativeEnum(MessageType).default(MessageType.text),
      text: z.string().optional(),
      mediaUrl: z.string().optional(),
      mediaDurationSec: z.number().min(0).optional(),
    })
    .refine(
      (data) => {
        if (data.type === MessageType.text && (!data.text || data.text.trim().length === 0)) {
          return false;
        }
        if (
          (data.type === MessageType.voice || data.type === MessageType.image) &&
          !data.mediaUrl
        ) {
          return false;
        }
        return true;
      },
      {
        message: "Text is required for text messages, mediaUrl is required for voice/image messages.",
      },
    ),
});

export const ChatValidations = {
  startConversationZodSchema,
  sendMessageZodSchema,
};

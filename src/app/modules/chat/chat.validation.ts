import { z } from "zod";
import { ConversationType, MessageType } from "./chat.interface";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID");

// The app says what the chat is about; the server finds the other person
const startConversationZodSchema = z.object({
  body: z.discriminatedUnion("type", [
    z.object({ type: z.literal(ConversationType.buyer_seller), vendorId: objectId }),
    // From the worker page (customer → worker) or from a booking (either side)
    z.object({ type: z.literal(ConversationType.worker), workerProfileId: objectId.optional(), bookingId: objectId.optional() }),
    z.object({
      type: z.literal(ConversationType.order),
      subOrderId: objectId,
      with: z.enum(["vendor", "rider", "customer"]),
    }),
    z.object({ type: z.literal(ConversationType.job_application), applicationId: objectId }),
  ]),
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
        message: "MESSAGE_CONTENT_REQUIRED",
      },
    ),
});

export const ChatValidations = {
  startConversationZodSchema,
  sendMessageZodSchema,
};

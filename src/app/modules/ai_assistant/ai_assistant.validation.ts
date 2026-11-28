import { z } from "zod";
import { AppMode } from "../user/user.interface";

/** A question: short on purpose (cost, and support questions are short) */
export const ASSISTANT_MAX_QUESTION = 500;

const sendMessageZodSchema = z.object({
  body: z.object({
    text: z.string().trim().min(2, "TEXT_TOO_SHORT").max(ASSISTANT_MAX_QUESTION, "TEXT_TOO_LONG"),
    // The mode the app is in (the assistant then knows about the store or the rider profile)
    mode: z.nativeEnum(AppMode).optional(),
  }),
});

const handOffZodSchema = z.object({
  body: z.object({
    note: z.string().trim().max(1000, "TEXT_TOO_LONG").optional(),
    mode: z.nativeEnum(AppMode).optional(),
  }),
});

export const AssistantValidations = {
  sendMessageZodSchema,
  handOffZodSchema,
};

import { z } from "zod";

export const sendTeamMessageZodSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i, "INVALID_ID"),
  title: z.string().trim().min(2, "TEXT_TOO_SHORT").max(80),
  // Not "body": validateRequest reads a "body" key as a request envelope
  message: z.string().trim().min(2, "TEXT_TOO_SHORT").max(1000),
});

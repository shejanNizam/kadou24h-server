import { z } from "zod";
import { BroadcastAudience } from "./team_broadcast.model";

export const sendTeamMessageZodSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i, "INVALID_ID"),
  title: z.string().trim().min(2, "TEXT_TOO_SHORT").max(80),
  // Not "body": validateRequest reads a "body" key as a request envelope
  message: z.string().trim().min(2, "TEXT_TOO_SHORT").max(1000),
});

/** One team message to whole groups (each person once) */
export const sendBroadcastZodSchema = z.object({
  title: z.string().trim().min(2, "TEXT_TOO_SHORT").max(80),
  message: z.string().trim().min(2, "TEXT_TOO_SHORT").max(1000),
  audiences: z.array(z.enum(Object.values(BroadcastAudience) as [string, ...string[]])).min(1, "FIELD_REQUIRED"),
});

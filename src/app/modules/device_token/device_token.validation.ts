import { z } from "zod";

// FCM / Expo push tokens are long random strings. Without a token the upsert would
// match some other phone's row and move it to this account (their pushes to me).
const token = z.string().trim().min(20, "Invalid device token").max(4096);

export const upsertDeviceTokenZodSchema = z.object({
  token,
  platform: z.enum(["ios", "android", "web"]),
});

export const removeDeviceTokenZodSchema = z.object({ token });

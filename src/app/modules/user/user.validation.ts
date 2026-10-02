import z from "zod";
import { AppMode, Language, UserRole, UserStatus } from "./user.interface";

// ── Shared field schemas (also used by the auth module) ──

export const phoneSchema = z
  .string({ error: "Phone must be string" })
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(
    z.string().regex(/^\+[1-9]\d{6,14}$/, {
      message: "Phone must be in international format, e.g. +224620123456",
    }),
  );

export const emailSchema = z
  .string({ error: "Email must be string" })
  .trim()
  .toLowerCase()
  .email({ message: "Invalid email address format." });

// Kept simple on purpose: many users type on basic phones.
export const passwordSchema = z
  .string({ error: "Password must be string" })
  .min(8, { message: "Password must be at least 8 characters long." })
  .max(64, { message: "Password cannot exceed 64 characters." })
  .regex(/[A-Za-z]/, { message: "Password must contain at least 1 letter." })
  .regex(/\d/, { message: "Password must contain at least 1 number." });

export const otpSchema = z
  .string({ error: "OTP must be a string" })
  .regex(/^\d{6}$/, { message: "OTP must be exactly 6 digits." });

export const nameSchema = z
  .string({ error: "Name must be string" })
  .trim()
  .min(2, { message: "Name must be at least 2 characters long." })
  .max(50, { message: "Name cannot exceed 50 characters." });

const avatarSchema = z.object({
  url: z.string().url({ message: "Avatar url must be a valid URL" }),
  publicId: z.string(),
});

// ── Self-service ──

export const updateMeZodSchema = z
  .object({
    name: nameSchema,
    avatar: avatarSchema,
    language: z.enum(Object.values(Language) as [string, ...string[]]),
    country: z.string().length(2, { message: "Country must be an ISO-2 code, e.g. GN" }).toUpperCase(),
  })
  .partial()
  .strict();

export const switchModeZodSchema = z.object({
  mode: z.enum(Object.values(AppMode) as [string, ...string[]], {
    error: "Mode must be customer, vendor or rider",
  }),
});

export const updateNotificationPrefsZodSchema = z
  .object({
    orderUpdates: z.boolean(),
    messages: z.boolean(),
    deliveryUpdates: z.boolean(),
    offers: z.boolean(),
    jobPosts: z.boolean(),
    accountAlerts: z.boolean(),
  })
  .partial()
  .strict();

export const requestPhoneChangeZodSchema = z.object({
  phone: phoneSchema,
});

export const verifyPhoneChangeZodSchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
});

// ── Admin ──

export const updateUserStatusZodSchema = z
  .object({
    status: z.enum(Object.values(UserStatus) as [string, ...string[]]),
    reason: z.string().trim().max(300).optional(),
  })
  .refine(
    (v) =>
      !(v.status === UserStatus.suspended || v.status === UserStatus.banned) || !!v.reason,
    { message: "A reason is required when suspending or banning", path: ["reason"] },
  );

export const createTeamMemberZodSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema.optional(),
  password: passwordSchema,
  role: z.enum([UserRole.staff, UserRole.admin], {
    error: "Role must be staff or admin",
  }),
});

export const updateTeamMemberZodSchema = z
  .object({
    role: z.enum([UserRole.staff, UserRole.admin]),
    status: z.enum([UserStatus.active, UserStatus.inactive, UserStatus.suspended]),
  })
  .partial()
  .strict();

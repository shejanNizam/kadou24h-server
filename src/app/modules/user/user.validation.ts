import z from "zod";
import { AppMode, Language, UserRole, UserStatus } from "./user.interface";

// ── Shared field schemas (also used by the auth module) ──
// Messages are error codes (i18n/errors/validation.ts), translated per request.
// A missing field gets FIELD_REQUIRED from zodErrorMap.

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(
    z.string().regex(/^\+[1-9]\d{6,14}$/, {
      message: "PHONE_FORMAT",
    }),
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: "EMAIL_INVALID" });

// Kept simple on purpose: many users type on basic phones.
export const passwordSchema = z
  .string()
  .min(8, { message: "PASSWORD_TOO_SHORT" })
  .max(64, { message: "PASSWORD_TOO_LONG" })
  .regex(/[A-Za-z]/, { message: "PASSWORD_NEEDS_LETTER" })
  .regex(/\d/, { message: "PASSWORD_NEEDS_NUMBER" });

export const otpSchema = z
  .string()
  .regex(/^\d{6}$/, { message: "OTP_FORMAT" });

export const nameSchema = z
  .string()
  .trim()
  .min(2, { message: "NAME_TOO_SHORT" })
  .max(50, { message: "NAME_TOO_LONG" });

const avatarSchema = z.object({
  url: z.string().url({ message: "URL_INVALID" }),
  publicId: z.string(),
});

// ── Self-service ──

export const updateMeZodSchema = z
  .object({
    name: nameSchema,
    avatar: avatarSchema,
    language: z.enum(Object.values(Language) as [string, ...string[]]),
    country: z.string().length(2, { message: "COUNTRY_CODE_INVALID" }).toUpperCase(),
  })
  .partial()
  .strict();

export const switchModeZodSchema = z.object({
  mode: z.enum(Object.values(AppMode) as [string, ...string[]], {
    error: "MODE_INVALID",
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
    { message: "STATUS_REASON_REQUIRED", path: ["reason"] },
  );

export const createTeamMemberZodSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema.optional(),
  password: passwordSchema,
  role: z.enum([UserRole.staff, UserRole.admin], {
    error: "ROLE_INVALID",
  }),
});

export const updateTeamMemberZodSchema = z
  .object({
    role: z.enum([UserRole.staff, UserRole.admin]),
    status: z.enum([UserStatus.active, UserStatus.inactive, UserStatus.suspended]),
  })
  .partial()
  .strict();

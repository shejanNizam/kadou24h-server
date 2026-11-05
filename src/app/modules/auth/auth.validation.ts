import z from "zod";
import { OtpPurpose } from "../otp/otp.interface";
import { Language } from "../user/user.interface";
import {
  emailSchema,
  nameSchema,
  otpSchema,
  passwordSchema,
  phoneSchema,
} from "../user/user.validation";

// Phone (+224...) or email
const identifierSchema = z
  .string()
  .trim()
  .min(3, { message: "IDENTIFIER_INVALID" })
  .refine(
    (v) => (v.includes("@") ? emailSchema.safeParse(v).success : phoneSchema.safeParse(v).success),
    { message: "IDENTIFIER_INVALID" },
  );

const languageSchema = z.enum(Object.values(Language) as [string, ...string[]]);

export const registerZodSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional(),
  password: passwordSchema,
  language: languageSchema.optional(),
  referralCode: z.string().trim().toUpperCase().length(8).optional(),
});

export const verifyAccountZodSchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
});

export const resendOtpZodSchema = z.object({
  identifier: identifierSchema,
  purpose: z.enum([OtpPurpose.verify_account, OtpPurpose.reset_password]),
});

export const loginZodSchema = z
  .object({
    identifier: identifierSchema.optional(),
    email: emailSchema.optional(),
    password: z.string().min(1, { message: "FIELD_REQUIRED" }),
  })
  .refine((data) => Boolean(data.identifier || data.email), {
    message: "IDENTIFIER_INVALID",
    path: ["identifier"],
  });

export const socialLoginZodSchema = z.object({
  provider: z.enum(["google", "apple"]),
  idToken: z.string().min(20),
  // Apple only sends the user's name on the very first sign-in, to the app
  name: nameSchema.optional(),
  language: languageSchema.optional(),
});

export const refreshTokenZodSchema = z.object({
  refreshToken: z.string().optional(), // falls back to the refreshToken cookie
});

export const logoutZodSchema = z.object({
  deviceToken: z.string().optional(), // stops push notifications to this device
});

export const changePasswordZodSchema = z
  .object({
    oldPassword: z.string().min(1, { message: "FIELD_REQUIRED" }),
    newPassword: passwordSchema,
  })
  .refine((v) => v.oldPassword !== v.newPassword, {
    message: "PASSWORD_SAME_AS_OLD",
    path: ["newPassword"],
  });

export const setPasswordZodSchema = z.object({
  password: passwordSchema,
});

export const forgotPasswordZodSchema = z.object({
  identifier: identifierSchema,
});

export const verifyResetOtpZodSchema = z.object({
  identifier: identifierSchema,
  otp: otpSchema,
});

export const resetPasswordZodSchema = z.object({
  newPassword: passwordSchema,
});

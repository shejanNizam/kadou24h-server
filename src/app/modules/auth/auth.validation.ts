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
  .string({ error: "Phone or email is required" })
  .trim()
  .min(3)
  .refine(
    (v) => (v.includes("@") ? emailSchema.safeParse(v).success : phoneSchema.safeParse(v).success),
    { message: "Enter a valid phone number (e.g. +224620123456) or email" },
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

export const loginZodSchema = z.object({
  identifier: identifierSchema,
  password: z.string({ error: "Password is required" }).min(1),
});

export const socialLoginZodSchema = z.object({
  provider: z.enum(["google", "apple"]),
  idToken: z.string({ error: "idToken is required" }).min(20),
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
    oldPassword: z.string({ error: "Old password is required" }).min(1),
    newPassword: passwordSchema,
  })
  .refine((v) => v.oldPassword !== v.newPassword, {
    message: "New password cannot be the same as the old password",
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

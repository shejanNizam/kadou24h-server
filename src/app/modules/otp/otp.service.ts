import crypto from "crypto";
import httpStatus from "http-status";
import { redisClient } from "../../config/redis.config";
import AppError from "../../errorHelpers/AppError";
import { logger } from "../../utils/logger";
import { sendEmail } from "../../utils/sendEmail";
import { sendSms } from "../../utils/sendSms";
import { Language } from "../user/user.interface";
import { IOtpRecipient, OtpPurpose } from "./otp.interface";

const OTP_LENGTH = 6;
const OTP_EXPIRATION = 5 * 60; // seconds the code stays valid
const OTP_RESEND_COOLDOWN = 60; // matches the 60s resend timer in the app
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_WINDOW = 10 * 60;
const OTP_DAILY_LIMIT = 10; // per target — caps SMS cost

const keys = (purpose: OtpPurpose, target: string) => ({
  code: `otp:${purpose}:${target}`,
  attempts: `otp:attempts:${purpose}:${target}`,
  cooldown: `otp:cooldown:${purpose}:${target}`,
  daily: `otp:daily:${target}`,
});

const hashOtp = (otp: string) =>
  crypto.createHash("sha256").update(otp).digest("hex");

const generateOtp = () =>
  String(crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH));

const smsText = (otp: string, language: Language) =>
  language === Language.en
    ? `Your Kadou24h code is ${otp}. It expires in ${OTP_EXPIRATION / 60} minutes. Never share it.`
    : `Votre code Kadou24h est ${otp}. Il expire dans ${OTP_EXPIRATION / 60} minutes. Ne le partagez jamais.`;

/**
 * Generates a code for `target` (a phone number or email) and delivers it by
 * SMS to `recipient.phone` and by email to `recipient.email` when present.
 * Succeeds if at least one channel delivered.
 *
 * `reuseRecent`: inside the resend cooldown, keep the code already sent
 * (still valid) and return the remaining timer instead of failing with 429.
 */
const issueOtp = async (
  purpose: OtpPurpose,
  target: string,
  recipient: IOtpRecipient,
  options: { reuseRecent?: boolean } = {},
) => {
  const k = keys(purpose, target);

  const cooldownLeft = await redisClient.ttl(k.cooldown);
  if (cooldownLeft > 0 && options.reuseRecent) {
    const codeTtl = await redisClient.ttl(k.code);
    if (codeTtl > 0) return { expiresIn: codeTtl, resendIn: cooldownLeft };
  }
  if (cooldownLeft > 0) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      `Please wait ${cooldownLeft}s before requesting a new code.`,
    );
  }

  const sentToday = Number(await redisClient.get(k.daily));
  if (sentToday >= OTP_DAILY_LIMIT) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "Daily code limit reached. Please try again tomorrow or contact support.",
    );
  }

  const otp = generateOtp();

  await Promise.all([
    redisClient.set(k.code, hashOtp(otp), {
      expiration: { type: "EX", value: OTP_EXPIRATION },
    }),
    redisClient.set(k.cooldown, "1", {
      expiration: { type: "EX", value: OTP_RESEND_COOLDOWN },
    }),
    redisClient.del([k.attempts]),
  ]);

  const deliveries: Promise<unknown>[] = [];
  if (recipient.phone) {
    deliveries.push(
      sendSms({ to: recipient.phone, message: smsText(otp, recipient.language) }),
    );
  }
  if (recipient.email) {
    deliveries.push(
      sendEmail({
        to: recipient.email,
        subject:
          recipient.language === Language.en
            ? "Your Kadou24h verification code"
            : "Votre code de vérification Kadou24h",
        templateName: "otp",
        templateData: {
          name: recipient.name,
          otp,
          expiresInMinutes: OTP_EXPIRATION / 60,
        },
      }),
    );
  }

  const results = await Promise.allSettled(deliveries);
  const delivered = results.filter((r) => r.status === "fulfilled").length;

  results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .forEach((r) => logger.warn("OTP channel failed", { purpose, reason: String(r.reason) }));

  if (delivered === 0) {
    await redisClient.del([k.code, k.cooldown]);
    throw new AppError(httpStatus.BAD_GATEWAY, "Could not send the verification code. Please try again.");
  }

  const count = await redisClient.incr(k.daily);
  if (count === 1) await redisClient.expire(k.daily, 24 * 60 * 60);

  return { expiresIn: OTP_EXPIRATION, resendIn: OTP_RESEND_COOLDOWN };
};

/** Throws unless `otp` matches; the code is consumed on success. */
const verifyOtp = async (purpose: OtpPurpose, target: string, otp: string) => {
  const k = keys(purpose, target);

  const attempts = Number(await redisClient.get(k.attempts));
  if (attempts >= OTP_MAX_ATTEMPTS) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "Too many failed attempts. Please request a new code.",
    );
  }

  const savedHash = await redisClient.get(k.code);
  if (!savedHash) {
    throw new AppError(httpStatus.BAD_REQUEST, "Code expired or not found. Please request a new one.");
  }

  const isMatch = crypto.timingSafeEqual(
    Buffer.from(savedHash),
    Buffer.from(hashOtp(otp)),
  );

  if (!isMatch) {
    const newAttempts = await redisClient.incr(k.attempts);
    if (newAttempts === 1) await redisClient.expire(k.attempts, OTP_LOCKOUT_WINDOW);
    const remaining = OTP_MAX_ATTEMPTS - newAttempts;
    throw new AppError(
      httpStatus.BAD_REQUEST,
      remaining > 0
        ? `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many failed attempts. Please request a new code.",
    );
  }

  // A used code no longer blocks a new one
  await redisClient.del([k.code, k.attempts, k.cooldown]);
};

export const OTPService = {
  issueOtp,
  verifyOtp,
};

import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../config/index";
import type { ErrorCode } from "../i18n/errors";
import { localeOf } from "../i18n/locale";
import { translateError } from "../i18n/translate";
import { verifyToken } from "../utils/jwt";

/**
 * Mobile carriers in Guinea put many people behind one IP address (CGNAT), so a
 * strict per-IP limit would block a whole neighbourhood because of one person.
 * Signed-in requests are therefore counted per account, and the sensitive auth /
 * code routes per IP + phone/email, with only a loose per-IP ceiling on top.
 */
const WINDOW_15_MIN = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "");

/** The account behind a valid access token (no database read: this runs on every request) */
const accountOf = (req: Request): string | null => {
  const token = req.headers.authorization?.split(" ")[1] ?? (req.cookies as Record<string, string> | undefined)?.accessToken;
  if (!token) return null;
  try {
    const decoded = verifyToken(token, configs.jwt_access_secret) as JwtPayload;
    return decoded?._id ? String(decoded._id) : null;
  } catch {
    return null;
  }
};

/** The phone / email a sign-in or code request is about, normalised */
const subjectOf = (req: Request): string => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body.identifier ?? body.phone ?? body.email ?? "";
  return typeof raw === "string" ? raw.replace(/[\s-]/g, "").toLowerCase() : "";
};

/** The 429 answer, in the same shape and language as every other error */
const limitedAnswer = (code: ErrorCode) => (req: Request) => ({
  success: false,
  code,
  message: translateError(code, localeOf(req)),
  errorSources: [],
});

const common = {
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  // Behind CGNAT the IP part is shared on purpose; the keys below add the account
  validate: { keyGeneratorIpFallback: false },
};

export const globalLimiter = rateLimit({
  ...common,
  windowMs: WINDOW_15_MIN,
  // ~1 request/second for one account (the app polls a few screens); a shared IP gets more room
  limit: (req: Request) => (accountOf(req) ? 900 : 1500),
  keyGenerator: (req: Request) => {
    const account = accountOf(req);
    return account ? `u:${account}` : `ip:${ipKey(req)}`;
  },
  message: limitedAnswer("TOO_MANY_REQUESTS"),
});

const authPerAccount = rateLimit({
  ...common,
  windowMs: WINDOW_15_MIN,
  limit: 10,
  keyGenerator: (req: Request) => `auth:${ipKey(req)}:${subjectOf(req)}`,
  message: limitedAnswer("TOO_MANY_AUTH_ATTEMPTS"),
});
const authPerIp = rateLimit({
  ...common,
  windowMs: WINDOW_15_MIN,
  limit: 300,
  keyGenerator: (req: Request) => `auth-ip:${ipKey(req)}`,
  message: limitedAnswer("TOO_MANY_AUTH_ATTEMPTS"),
});
// For login, refresh-token, change/set/reset-password, social sign-in, code checks
export const authLimiter = [authPerIp, authPerAccount];

// Routes that send an SMS / email code. The real cap is per phone/email in
// OTPService (60 s cooldown, 10 codes a day) plus a daily SMS budget.
const otpPerTarget = rateLimit({
  ...common,
  windowMs: HOUR,
  limit: 8,
  keyGenerator: (req: Request) => `otp:${ipKey(req)}:${subjectOf(req)}`,
  message: limitedAnswer("TOO_MANY_CODE_REQUESTS"),
});
const otpPerIp = rateLimit({
  ...common,
  windowMs: HOUR,
  limit: 120,
  keyGenerator: (req: Request) => `otp-ip:${ipKey(req)}`,
  message: limitedAnswer("TOO_MANY_CODE_REQUESTS"),
});
export const otpLimiter = [otpPerIp, otpPerTarget];

/** Uploads cost storage: per account */
export const uploadLimiter = rateLimit({
  ...common,
  windowMs: WINDOW_15_MIN,
  limit: 60,
  keyGenerator: (req: Request) => {
    const account = accountOf(req);
    return account ? `up:${account}` : `up-ip:${ipKey(req)}`;
  },
  message: limitedAnswer("TOO_MANY_UPLOADS"),
});

/** Help assistant: each question costs an AI call (the daily allowance is counted in the service) */
export const assistantLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req: Request) => {
    const account = accountOf(req);
    return account ? `ai:${account}` : `ai-ip:${ipKey(req)}`;
  },
  message: limitedAnswer("ASSISTANT_TOO_FAST"),
});

/** Crash reports from the app: a phone stuck in a crash loop must not flood the database */
export const appErrorLimiter = rateLimit({
  ...common,
  windowMs: WINDOW_15_MIN,
  limit: 20,
  keyGenerator: (req: Request) => {
    const account = accountOf(req);
    return account ? `err:${account}` : `err-ip:${ipKey(req)}`;
  },
  message: limitedAnswer("TOO_MANY_REPORTS"),
});

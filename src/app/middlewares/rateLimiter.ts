import rateLimit from "express-rate-limit";

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});

// For login, refresh-token, logout, change/set/reset-password, google auth
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many auth attempts, please try again later." },
});

// For routes that send an OTP. Mobile carriers in Guinea put many users behind
// one IP, so this per-IP limit is loose; the real cap is per phone/email in
// OTPService (60s cooldown, 10 codes per day).
export const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many code requests, please try again later." },
});

import { Router } from "express";
import { checkAuth, checkResetToken } from "../../middlewares/checkAuth";
import { authLimiter, otpLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { ALL_ROLES } from "../user/user.interface";
import { AuthControllers } from "./auth.controller";
import {
  changePasswordZodSchema,
  forgotPasswordZodSchema,
  loginZodSchema,
  logoutZodSchema,
  refreshTokenZodSchema,
  registerZodSchema,
  resendOtpZodSchema,
  resetPasswordZodSchema,
  setPasswordZodSchema,
  socialLoginZodSchema,
  verifyAccountZodSchema,
  verifyResetOtpZodSchema,
} from "./auth.validation";

const router = Router();

// ──────────────────────────────
// Sign up
// ──────────────────────────────

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create an account (always a customer) — sends a 6-digit code by SMS and email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Account created, code sent
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OtpSentResponse'
 *       409:
 *         description: Phone or email already used
 *       422:
 *         description: Validation error
 */
router.post(
  "/register",
  otpLimiter,
  validateRequest(registerZodSchema),
  AuthControllers.register,
);

/**
 * @swagger
 * /auth/verify-account:
 *   post:
 *     tags: [Auth]
 *     summary: Confirm the signup code — returns tokens (user is logged in)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyAccountRequest'
 *     responses:
 *       200:
 *         description: Verified and logged in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSessionResponse'
 *       400:
 *         description: Invalid / expired code, or already verified
 *       429:
 *         description: Too many wrong attempts
 */
router.post(
  "/verify-account",
  authLimiter,
  validateRequest(verifyAccountZodSchema),
  AuthControllers.verifyAccount,
);

/**
 * @swagger
 * /auth/resend-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Resend a signup or password-reset code (60s cooldown, 10 per day)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, purpose]
 *             properties:
 *               identifier: { type: string, example: "+224620123456" }
 *               purpose: { type: string, enum: [verify_account, reset_password] }
 *     responses:
 *       200:
 *         description: Code sent
 *       429:
 *         description: Cooldown or daily limit
 */
router.post(
  "/resend-otp",
  otpLimiter,
  validateRequest(resendOtpZodSchema),
  AuthControllers.resendOtp,
);

// ──────────────────────────────
// Sign in / session
// ──────────────────────────────

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with phone or email + password
 *     description: |
 *       If the account was never verified, no tokens are returned — instead
 *       `data.requiresVerification = true` and a new code is sent. Show the OTP screen,
 *       then call /auth/verify-account.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Logged in (or requiresVerification)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSessionResponse'
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account suspended / banned
 */
router.post("/login", authLimiter, validateRequest(loginZodSchema), AuthControllers.login);

/**
 * @swagger
 * /auth/social:
 *   post:
 *     tags: [Auth]
 *     summary: Continue with Google or Apple (ID token from the native SDK)
 *     description: |
 *       Creates the account on first use. When `data.requiresPhone = true`, ask the user
 *       for a phone number (POST /user/me/phone/request) before checkout.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SocialLoginRequest'
 *     responses:
 *       200:
 *         description: Logged in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSessionResponse'
 *       401:
 *         description: Invalid ID token
 */
router.post(
  "/social",
  authLimiter,
  validateRequest(socialLoginZodSchema),
  AuthControllers.socialLogin,
);

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Get a new access token (refreshToken in body, or cookie)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: New access token
 *       401:
 *         description: Invalid / expired refresh token, or signed out everywhere
 */
router.post(
  "/refresh-token",
  authLimiter,
  validateRequest(refreshTokenZodSchema),
  AuthControllers.getNewAccessToken,
);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out this device (pass deviceToken to stop its push notifications)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceToken: { type: string }
 *     responses:
 *       200:
 *         description: Logged out
 * /auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Log out from every device
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All sessions revoked
 */
router.post("/logout", validateRequest(logoutZodSchema), AuthControllers.logout);
router.post("/logout-all", checkAuth(...ALL_ROLES), AuthControllers.logoutAll);

// ──────────────────────────────
// Passwords
// ──────────────────────────────

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password — other devices are signed out, new tokens returned
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed — use the returned tokens
 *       401:
 *         description: Old password does not match
 * /auth/set-password:
 *   post:
 *     tags: [Auth]
 *     summary: Add a password to a Google / Apple account
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, example: "kadou2026" }
 *     responses:
 *       200:
 *         description: Password set
 */
router.post(
  "/change-password",
  authLimiter,
  checkAuth(...ALL_ROLES),
  validateRequest(changePasswordZodSchema),
  AuthControllers.changePassword,
);
router.post(
  "/set-password",
  authLimiter,
  checkAuth(...ALL_ROLES),
  validateRequest(setPasswordZodSchema),
  AuthControllers.setPassword,
);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: "Step 1/3 — send a reset code (same response whether or not the account exists)"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier]
 *             properties:
 *               identifier: { type: string, example: "+224620123456" }
 *     responses:
 *       200:
 *         description: Code sent if the account exists
 * /auth/verify-reset-otp:
 *   post:
 *     tags: [Auth]
 *     summary: "Step 2/3 — verify the code, get a 10-minute resetToken"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, otp]
 *             properties:
 *               identifier: { type: string, example: "+224620123456" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: "{ resetToken, expiresIn }"
 *       400:
 *         description: Invalid / expired code
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: "Step 3/3 — set the new password (Authorization: Bearer <resetToken>)"
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string, example: "kadou2026" }
 *     responses:
 *       200:
 *         description: Password reset — every device is signed out
 *       401:
 *         description: Reset token invalid, expired or already used
 */
router.post(
  "/forgot-password",
  otpLimiter,
  validateRequest(forgotPasswordZodSchema),
  AuthControllers.forgotPassword,
);
router.post(
  "/verify-reset-otp",
  authLimiter,
  validateRequest(verifyResetOtpZodSchema),
  AuthControllers.verifyResetOtp,
);
router.post(
  "/reset-password",
  authLimiter,
  checkResetToken,
  validateRequest(resetPasswordZodSchema),
  AuthControllers.resetPassword,
);

export const AuthRoutes = router;

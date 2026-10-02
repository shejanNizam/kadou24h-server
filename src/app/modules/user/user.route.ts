import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { otpLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { UserControllers } from "./user.controller";
import { ADMIN_ROLES, ALL_ROLES, UserRole } from "./user.interface";
import {
  createTeamMemberZodSchema,
  requestPhoneChangeZodSchema,
  switchModeZodSchema,
  updateMeZodSchema,
  updateNotificationPrefsZodSchema,
  updateTeamMemberZodSchema,
  updateUserStatusZodSchema,
  verifyPhoneChangeZodSchema,
} from "./user.validation";

const router = Router();
const manageRoles = [UserRole.admin, UserRole.super_admin];

// ──────────────────────────────
// Self-service (/user/me...) — any signed-in user
// ──────────────────────────────

/**
 * @swagger
 * /user/me:
 *   get:
 *     tags: [User]
 *     summary: Get my profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *   patch:
 *     tags: [User]
 *     summary: Update my profile (name, avatar, language, country)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateMeRequest'
 *     responses:
 *       200:
 *         description: Updated profile
 *       422:
 *         description: Validation error
 *   delete:
 *     tags: [User]
 *     summary: Delete my account (soft delete — phone/email become reusable)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account deleted
 */
router.get("/me", checkAuth(...ALL_ROLES), UserControllers.getMe);
router.patch(
  "/me",
  checkAuth(...ALL_ROLES),
  validateRequest(updateMeZodSchema),
  UserControllers.updateMe,
);
router.delete("/me", checkAuth(...ALL_ROLES), UserControllers.deleteMe);

/**
 * @swagger
 * /user/me/mode:
 *   patch:
 *     tags: [User]
 *     summary: Switch app mode (customer / vendor / rider) — role must be approved
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mode]
 *             properties:
 *               mode: { type: string, enum: [customer, vendor, rider] }
 *     responses:
 *       200:
 *         description: Mode switched
 *       403:
 *         description: Role not approved yet
 */
router.patch(
  "/me/mode",
  checkAuth(...ALL_ROLES),
  validateRequest(switchModeZodSchema),
  UserControllers.switchMode,
);

/**
 * @swagger
 * /user/me/notification-preferences:
 *   patch:
 *     tags: [User]
 *     summary: Turn notification categories on or off
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationPrefs'
 *     responses:
 *       200:
 *         description: Updated preferences
 */
router.patch(
  "/me/notification-preferences",
  checkAuth(...ALL_ROLES),
  validateRequest(updateNotificationPrefsZodSchema),
  UserControllers.updateNotificationPrefs,
);

/**
 * @swagger
 * /user/me/phone/request:
 *   post:
 *     tags: [User]
 *     summary: Add or change my phone number — sends an SMS code to the new number
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: "+224620123456" }
 *     responses:
 *       200:
 *         description: Code sent
 *       409:
 *         description: Phone already used by another account
 *       429:
 *         description: Wait before requesting another code
 * /user/me/phone/verify:
 *   post:
 *     tags: [User]
 *     summary: Confirm the new phone number with the SMS code
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone: { type: string, example: "+224620123456" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Phone verified — updated profile returned
 *       400:
 *         description: Invalid or expired code
 */
router.post(
  "/me/phone/request",
  otpLimiter,
  checkAuth(...ALL_ROLES),
  validateRequest(requestPhoneChangeZodSchema),
  UserControllers.requestPhoneChange,
);
router.post(
  "/me/phone/verify",
  checkAuth(...ALL_ROLES),
  validateRequest(verifyPhoneChangeZodSchema),
  UserControllers.verifyPhoneChange,
);

// ──────────────────────────────
// Admin — team members (Settings → Members & Access)
// ──────────────────────────────

/**
 * @swagger
 * /user/team:
 *   get:
 *     tags: [User — Admin]
 *     summary: List admin team members (admin, super_admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/searchTerm'
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Paginated team members
 *   post:
 *     tags: [User — Admin]
 *     summary: Create a team member (super_admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTeamMemberRequest'
 *     responses:
 *       201:
 *         description: Team member created
 *       409:
 *         description: Email already in use
 * /user/team/{id}:
 *   patch:
 *     tags: [User — Admin]
 *     summary: Change a team member's role or status (super_admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role: { type: string, enum: [staff, admin] }
 *               status: { type: string, enum: [active, inactive, suspended] }
 *     responses:
 *       200:
 *         description: Team member updated
 */
router.get("/team", checkAuth(...manageRoles), UserControllers.getTeamMembers);
router.post(
  "/team",
  checkAuth(UserRole.super_admin),
  validateRequest(createTeamMemberZodSchema),
  UserControllers.createTeamMember,
);
router.patch(
  "/team/:id",
  checkAuth(UserRole.super_admin),
  validateRequest(updateTeamMemberZodSchema),
  UserControllers.updateTeamMember,
);

// ──────────────────────────────
// Admin — app users
// ──────────────────────────────

/**
 * @swagger
 * /user:
 *   get:
 *     tags: [User — Admin]
 *     summary: List app users (all admin roles). Filter with any field, e.g. ?roles=vendor&status=suspended
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/searchTerm'
 *       - { in: query, name: roles, schema: { type: string, enum: [customer, vendor, rider] } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, suspended, banned] } }
 *       - { in: query, name: country, schema: { type: string, example: GN } }
 *       - $ref: '#/components/parameters/sort'
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Paginated users
 * /user/{id}:
 *   get:
 *     tags: [User — Admin]
 *     summary: Get one user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: User
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [User — Admin]
 *     summary: Delete a user (admin, super_admin) — soft delete, audited
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Deleted
 * /user/{id}/status:
 *   patch:
 *     tags: [User — Admin]
 *     summary: Activate / deactivate / suspend / ban a user (admin, super_admin) — audited
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [active, inactive, suspended, banned] }
 *               reason: { type: string, description: "Required for suspended / banned" }
 *     responses:
 *       200:
 *         description: Status updated
 */
router.get("/", checkAuth(...ADMIN_ROLES), UserControllers.getAllUsers);
router.get("/:id", checkAuth(...ADMIN_ROLES), UserControllers.getSingleUser);
router.patch(
  "/:id/status",
  checkAuth(...manageRoles),
  validateRequest(updateUserStatusZodSchema),
  UserControllers.updateUserStatus,
);
router.delete("/:id", checkAuth(...manageRoles), UserControllers.deleteUser);

export const UserRoutes = router;

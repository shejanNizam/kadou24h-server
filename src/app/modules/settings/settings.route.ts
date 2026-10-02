import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, UserRole } from "../user/user.interface";
import { SettingsControllers } from "./settings.controller";
import { updateSettingsZodSchema } from "./settings.validation";

const router = Router();

/**
 * @swagger
 * /settings/public:
 *   get:
 *     tags: [Settings]
 *     summary: Public platform settings (fees, support contacts) — no auth
 *     responses:
 *       200:
 *         description: Public settings
 */
router.get("/public", SettingsControllers.getPublicSettings);

/**
 * @swagger
 * /settings:
 *   get:
 *     tags: [Settings]
 *     summary: Full platform settings (admin panel)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Full settings document
 *       403:
 *         description: Forbidden
 *   patch:
 *     tags: [Settings]
 *     summary: Update platform settings (admin, super_admin) — partial update, audited
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateSettingsRequest'
 *     responses:
 *       200:
 *         description: Updated settings
 *       422:
 *         description: Validation error
 */
router.get("/", checkAuth(...ADMIN_ROLES), SettingsControllers.getSettings);

router.patch(
  "/",
  checkAuth(UserRole.admin, UserRole.super_admin),
  validateRequest(updateSettingsZodSchema),
  SettingsControllers.updateSettings,
);

export const SettingsRoutes = router;

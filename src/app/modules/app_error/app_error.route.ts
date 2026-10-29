import { Router } from "express";
import { checkAuth, optionalAuth } from "../../middlewares/checkAuth";
import { appErrorLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES } from "../user/user.interface";
import { AppErrorControllers } from "./app_error.controller";
import { reportAppErrorZodSchema } from "./app_error.validation";

const router = Router();

/**
 * @swagger
 * /app-errors:
 *   post:
 *     tags: [App Errors]
 *     summary: The mobile app reports a JavaScript error (signed in or not)
 *     description: Sent just before an error closes the app, so the team can see why. Kept 30 days.
 *     responses:
 *       201:
 *         description: Saved
 *   get:
 *     tags: [App Errors]
 *     summary: Latest app errors, newest first (staff)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: fatal, schema: { type: boolean }, description: "true: only those that closed the app" }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Paginated list
 */
router.post("/", appErrorLimiter, optionalAuth, validateRequest(reportAppErrorZodSchema), AppErrorControllers.report);
router.get("/", checkAuth(...ADMIN_ROLES), AppErrorControllers.list);

export const AppErrorRoutes = router;

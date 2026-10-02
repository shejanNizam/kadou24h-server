import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { AuditLogControllers } from "./audit_log.controller";

const router = Router();

/**
 * @swagger
 * /audit-logs:
 *   get:
 *     tags: [Audit Log]
 *     summary: List admin / money actions (admin, super_admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: targetType, schema: { type: string }, description: "e.g. user, settings" }
 *       - { in: query, name: targetId, schema: { type: string } }
 *       - { in: query, name: actorId, schema: { type: string } }
 *       - { in: query, name: action, schema: { type: string }, description: "e.g. user.suspend" }
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Paginated audit logs
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  checkAuth(UserRole.admin, UserRole.super_admin),
  AuditLogControllers.getAuditLogs,
);

export const AuditLogRoutes = router;

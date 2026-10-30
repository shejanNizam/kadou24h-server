import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES } from "../user/user.interface";
import { sendTeamMessageZodSchema } from "./notification.validation";
import { NotificationControllers } from "./notification.controller";

const router = Router();

// The Kadou24h team writes to one user (shown with a "Kadou24h Team" badge, audit-logged)
router.post("/admin/team-message", checkAuth(...ADMIN_ROLES), validateRequest(sendTeamMessageZodSchema), NotificationControllers.sendTeamMessage);
router.get("/admin/team-messages/:userId", checkAuth(...ADMIN_ROLES), NotificationControllers.getTeamMessages);

/**
 * @swagger
 * /notifications:
 *   get:
 *     tags: [Notification]
 *     summary: Get my notification list
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of notifications
 */
router.get("/", checkAuth(...ALL_ROLES), NotificationControllers.getMyNotifications);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     tags: [Notification]
 *     summary: Get total count of unread notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread notification count
 */
router.get("/unread-count", checkAuth(...ALL_ROLES), NotificationControllers.getUnreadCount);

/**
 * @swagger
 * /notifications/read-all:
 *   patch:
 *     tags: [Notification]
 *     summary: Mark all notifications as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All marked as read
 */
router.patch("/read-all", checkAuth(...ALL_ROLES), NotificationControllers.markAllAsRead);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     tags: [Notification]
 *     summary: Mark specific notification as read
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 */
router.patch("/:id/read", checkAuth(...ALL_ROLES), NotificationControllers.markAsRead);

/**
 * @swagger
 * /notifications:
 *   delete:
 *     tags: [Notification]
 *     summary: Delete all my notifications (of one mode's list when ?mode= is given)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: "{ deletedCount }"
 */
router.delete("/", checkAuth(...ALL_ROLES), NotificationControllers.deleteAllNotifications);

/**
 * @swagger
 * /notifications/{id}:
 *   delete:
 *     tags: [Notification]
 *     summary: Delete one of my notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not mine or not found
 */
router.delete("/:id", checkAuth(...ALL_ROLES), NotificationControllers.deleteNotification);

export const NotificationRoutes = router;

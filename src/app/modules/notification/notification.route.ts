import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { ALL_ROLES } from "../user/user.interface";
import { NotificationControllers } from "./notification.controller";

const router = Router();

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

export const NotificationRoutes = router;

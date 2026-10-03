import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { ALL_ROLES } from "../user/user.interface";
import { NotificationControllers } from "./notification.controller";

const router = Router();

router.get("/", checkAuth(...ALL_ROLES), NotificationControllers.getMyNotifications);
router.get("/unread-count", checkAuth(...ALL_ROLES), NotificationControllers.getUnreadCount);
router.patch("/read-all", checkAuth(...ALL_ROLES), NotificationControllers.markAllAsRead);
router.patch("/:id/read", checkAuth(...ALL_ROLES), NotificationControllers.markAsRead);

export const NotificationRoutes = router;

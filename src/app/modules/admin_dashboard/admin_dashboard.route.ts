import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { ADMIN_ROLES } from "../user/user.interface";
import { AdminDashboardControllers } from "./admin_dashboard.controller";

const router = Router();

/**
 * @swagger
 * /admin/dashboard/overview:
 *   get:
 *     tags: [Admin Dashboard]
 *     summary: Get admin platform analytics overview
 *     description: Returns revenue breakdown, orders donut distribution across 7 statuses, and 12-month platform growth metrics for charts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Overview analytics retrieved successfully
 */
router.get("/overview", checkAuth(...ADMIN_ROLES), AdminDashboardControllers.getPlatformOverview);

export const AdminDashboardRoutes = router;

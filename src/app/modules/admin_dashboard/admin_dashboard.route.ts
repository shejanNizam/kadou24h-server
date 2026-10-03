import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { ADMIN_ROLES } from "../user/user.interface";
import { AdminDashboardControllers } from "./admin_dashboard.controller";

const router = Router();

router.get("/overview", checkAuth(...ADMIN_ROLES), AdminDashboardControllers.getPlatformOverview);

export const AdminDashboardRoutes = router;

import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES } from "../user/user.interface";
import { ReportControllers } from "./report.controller";
import { ReportValidations } from "./report.validation";

const router = Router();

// User reports
router.post(
  "/",
  checkAuth(...ALL_ROLES),
  validateRequest(ReportValidations.createReportZodSchema),
  ReportControllers.createReport,
);
router.get("/me", checkAuth(...ALL_ROLES), ReportControllers.getMyReports);

// Admin reports queue
router.get("/admin/all", checkAuth(...ADMIN_ROLES), ReportControllers.getAllReportsAdmin);
router.patch(
  "/admin/:id/action",
  checkAuth(...ADMIN_ROLES),
  validateRequest(ReportValidations.actionReportZodSchema),
  ReportControllers.actionReportAdmin,
);

export const ReportRoutes = router;

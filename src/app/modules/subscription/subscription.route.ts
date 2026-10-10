import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, APP_ROLES } from "../user/user.interface";
import { SubscriptionControllers } from "./subscription.controller";
import {
  createPlanSchema,
  subscribeSchema,
  updatePlanSchema,
} from "./subscription.validation";

const router = Router();

// Public plans
router.get("/plans", SubscriptionControllers.getActivePlans);

// Authenticated user subscription
router.get("/me", checkAuth(...APP_ROLES), SubscriptionControllers.getMySubscription);
router.post(
  "/subscribe",
  checkAuth(...APP_ROLES),
  validateRequest(subscribeSchema),
  SubscriptionControllers.subscribe,
);

// Admin plan management
router.get("/admin/plans", checkAuth(...ADMIN_ROLES), SubscriptionControllers.getAllPlansForAdmin);

router.post(
  "/admin/plans",
  checkAuth(...ADMIN_ROLES),
  validateRequest(createPlanSchema),
  SubscriptionControllers.createPlan,
);

router.patch(
  "/admin/plans/:id",
  checkAuth(...ADMIN_ROLES),
  validateRequest(updatePlanSchema),
  SubscriptionControllers.updatePlan,
);

export const SubscriptionRoutes = router;

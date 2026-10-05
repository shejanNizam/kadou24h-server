import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ALL_ROLES, UserRole } from "../user/user.interface";
import { DeliveryRateControllers } from "./delivery_rate.controller";
import { DeliveryRateValidations } from "./delivery_rate.validation";

const router = Router();
const manageRoles = [UserRole.admin, UserRole.super_admin];

/** Calculate delivery fee (local distance or intercity route) */
router.get("/calculate", DeliveryRateControllers.calculateDeliveryFee);

/** List delivery rates */
router.get(
  "/",
  checkAuth(...ALL_ROLES),
  DeliveryRateControllers.getAllDeliveryRates,
);

/** Get delivery rate by ID */
router.get(
  "/:id",
  checkAuth(...ALL_ROLES),
  DeliveryRateControllers.getDeliveryRateById,
);

/** Create a new delivery rate (admin only) */
router.post(
  "/",
  checkAuth(...manageRoles),
  validateRequest(DeliveryRateValidations.createDeliveryRateSchema),
  DeliveryRateControllers.createDeliveryRate,
);

/** Update delivery rate (admin only) */
router.patch(
  "/:id",
  checkAuth(...manageRoles),
  validateRequest(DeliveryRateValidations.updateDeliveryRateSchema),
  DeliveryRateControllers.updateDeliveryRate,
);

/** Deactivate delivery rate (admin only) */
router.delete(
  "/:id",
  checkAuth(...manageRoles),
  DeliveryRateControllers.deleteDeliveryRate,
);

export const DeliveryRateRoutes = router;

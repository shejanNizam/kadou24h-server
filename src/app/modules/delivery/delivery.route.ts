import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES, UserRole } from "../user/user.interface";
import { DeliveryControllers } from "./delivery.controller";
import { DeliveryValidations } from "./delivery.validation";

const router = Router();
const riderRoles = [UserRole.rider, ...ADMIN_ROLES];
const vendorRoles = [UserRole.vendor, ...ADMIN_ROLES];

// --- Rider Real-time Location & Driver Mode ---
router.patch(
  "/rider/location",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.updateLocationSchema),
  DeliveryControllers.updateRiderLocation,
);

router.patch(
  "/rider/online-status",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.toggleOnlineSchema),
  DeliveryControllers.toggleRiderOnline,
);

router.get(
  "/rider/my-deliveries",
  checkAuth(...riderRoles),
  DeliveryControllers.getMyDeliveries,
);

// --- Vendor Assignment ---
router.get(
  "/:id/available-riders",
  checkAuth(...vendorRoles),
  DeliveryControllers.getAvailableRiders,
);

router.post(
  "/:id/assign",
  checkAuth(...vendorRoles),
  validateRequest(DeliveryValidations.assignRiderSchema),
  DeliveryControllers.assignRider,
);

// --- Rider Leg Lifecycle ---
router.post(
  "/:id/accept",
  checkAuth(...riderRoles),
  DeliveryControllers.acceptDelivery,
);

router.post(
  "/:id/decline",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.declineDeliverySchema),
  DeliveryControllers.declineDelivery,
);

router.patch(
  "/:id/going-to-pickup",
  checkAuth(...riderRoles),
  DeliveryControllers.goingToPickup,
);

router.post(
  "/:id/verify-pickup",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.verifyPinSchema),
  DeliveryControllers.verifyPickup,
);

router.post(
  "/:id/verify-handover",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.verifyPinSchema),
  DeliveryControllers.verifyHandover,
);

// --- Live Tracking Details ---
router.get("/:id/track", checkAuth(...ALL_ROLES), DeliveryControllers.trackDelivery);

export const DeliveryRoutes = router;

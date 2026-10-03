import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES } from "../user/user.interface";
import { AdvertisementControllers } from "./advertisement.controller";
import { AdvertisementValidations } from "./advertisement.validation";

const router = Router();

// Admin routes (must precede /:id)
router.post(
  "/admin",
  checkAuth(...ADMIN_ROLES),
  validateRequest(AdvertisementValidations.createAdZodSchema),
  AdvertisementControllers.createAdAdmin,
);
router.get("/admin/all", checkAuth(...ADMIN_ROLES), AdvertisementControllers.getAllAdsAdmin);
router.get("/admin/:id", checkAuth(...ADMIN_ROLES), AdvertisementControllers.getAdByIdAdmin);
router.patch(
  "/admin/:id",
  checkAuth(...ADMIN_ROLES),
  validateRequest(AdvertisementValidations.updateAdZodSchema),
  AdvertisementControllers.updateAdAdmin,
);
router.delete("/admin/:id", checkAuth(...ADMIN_ROLES), AdvertisementControllers.deleteAdAdmin);

// Public banner delivery and telemetry
router.get("/", AdvertisementControllers.getActiveAds);
router.post("/:id/impression", AdvertisementControllers.recordImpression);
router.post("/:id/click", AdvertisementControllers.recordClick);

export const AdvertisementRoutes = router;

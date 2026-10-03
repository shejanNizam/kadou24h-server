import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { APP_ROLES } from "../user/user.interface";
import { ProfessionalProfileControllers } from "./professional_profile.controller";
import {
  generateAiCvSchema,
  toggleWorkerListingSchema,
  upsertProfileSchema,
} from "./professional_profile.validation";

const router = Router();

// Public worker directory
router.get("/workers", ProfessionalProfileControllers.searchWorkers);
router.get("/workers/:id", ProfessionalProfileControllers.getWorkerById);

// Authenticated user profile endpoints
router.get(
  "/me",
  checkAuth(...APP_ROLES),
  ProfessionalProfileControllers.getMyProfile,
);

router.put(
  "/me",
  checkAuth(...APP_ROLES),
  validateRequest(upsertProfileSchema),
  ProfessionalProfileControllers.upsertProfile,
);

router.patch(
  "/me/worker-listing",
  checkAuth(...APP_ROLES),
  validateRequest(toggleWorkerListingSchema),
  ProfessionalProfileControllers.toggleWorkerListing,
);

router.post(
  "/me/generate-ai-cv",
  checkAuth(...APP_ROLES),
  validateRequest(generateAiCvSchema),
  ProfessionalProfileControllers.generateAiCv,
);

export const ProfessionalProfileRoutes = router;

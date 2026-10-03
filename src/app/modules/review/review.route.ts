import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES, APP_ROLES } from "../user/user.interface";
import { ReviewControllers } from "./review.controller";
import { ReviewValidations } from "./review.validation";

const router = Router();

// Admin review moderation
router.patch(
  "/admin/:id/status",
  checkAuth(...ADMIN_ROLES),
  validateRequest(ReviewValidations.updateReviewStatusZodSchema),
  ReviewControllers.updateReviewStatusAdmin,
);

// Customer review submission & personal review history
router.post(
  "/",
  checkAuth(...APP_ROLES),
  validateRequest(ReviewValidations.createReviewZodSchema),
  ReviewControllers.createReview,
);
router.get("/me", checkAuth(...ALL_ROLES), ReviewControllers.getMyReviews);

// Report a review
router.post("/:id/report", checkAuth(...ALL_ROLES), ReviewControllers.reportReview);

// Public review feeds for stores and products
router.get("/vendor/:vendorId", ReviewControllers.getVendorReviews);
router.get("/product/:productId", ReviewControllers.getProductReviews);

export const ReviewRoutes = router;

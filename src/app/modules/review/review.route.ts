import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES, APP_ROLES } from "../user/user.interface";
import { ReviewControllers } from "./review.controller";
import { ReviewValidations } from "./review.validation";

const router = Router();

// Admin review moderation

/**
 * @swagger
 * /reviews/admin/{id}/status:
 *   patch:
 *     tags: [Review]
 *     summary: Moderate review status (Admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [published, hidden, flagged] }
 *     responses:
 *       200:
 *         description: Review status updated
 */
router.patch(
  "/admin/:id/status",
  checkAuth(...ADMIN_ROLES),
  validateRequest(ReviewValidations.updateReviewStatusZodSchema),
  ReviewControllers.updateReviewStatusAdmin,
);

// Customer review submission & personal review history

/**
 * @swagger
 * /reviews:
 *   post:
 *     tags: [Review]
 *     summary: Submit a review for product or vendor (Customer)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating, comment]
 *             properties:
 *               productId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *               vendorId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e1" }
 *               rating: { type: integer, example: 5 }
 *               comment: { type: string, example: "Excellent product quality and fast delivery!" }
 *     responses:
 *       201:
 *         description: Review submitted successfully
 */
router.post(
  "/",
  checkAuth(...APP_ROLES),
  validateRequest(ReviewValidations.createReviewZodSchema),
  ReviewControllers.createReview,
);

/**
 * @swagger
 * /reviews/me:
 *   get:
 *     tags: [Review]
 *     summary: Get reviews submitted by current user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of my reviews
 */
router.get("/me", checkAuth(...ALL_ROLES), ReviewControllers.getMyReviews);

// Report a review
router.post("/:id/report", checkAuth(...ALL_ROLES), ReviewControllers.reportReview);

// Public review feeds for stores and products

/**
 * @swagger
 * /reviews/vendor/{vendorId}:
 *   get:
 *     tags: [Review]
 *     summary: Get public reviews for a vendor store
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of vendor reviews
 */
router.get("/vendor/:vendorId", ReviewControllers.getVendorReviews);

/**
 * @swagger
 * /reviews/product/{productId}:
 *   get:
 *     tags: [Review]
 *     summary: Get public reviews for a product
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of product reviews
 */
router.get("/product/:productId", ReviewControllers.getProductReviews);

export const ReviewRoutes = router;

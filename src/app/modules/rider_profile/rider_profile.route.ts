import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import {
  reviewApplicationZodSchema,
  reviewDocumentZodSchema,
} from "../profile_common/profile.common";
import { ADMIN_ROLES, APP_ROLES, UserRole } from "../user/user.interface";
import { RiderProfileControllers } from "./rider_profile.controller";
import {
  saveRiderApplicationZodSchema,
  updateMyRiderProfileZodSchema,
} from "./rider_profile.validation";

const router = Router();
const manageRoles = [UserRole.admin, UserRole.super_admin];

// ──────────────────────────────
// Applicant / rider (/riders/me…)
// ──────────────────────────────

/**
 * @swagger
 * /riders/me:
 *   get:
 *     tags: [Rider]
 *     summary: My delivery partner profile / application (any status)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rider profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/RiderProfile'
 *       404:
 *         description: No application yet
 *   patch:
 *     tags: [Rider]
 *     summary: Update vehicle color/brand/plate, vest, city area, bus routes (approved riders)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 * /riders/me/application:
 *   put:
 *     tags: [Rider]
 *     summary: Save the "Become a Delivery Partner" draft (any subset of fields)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RiderApplicationRequest'
 *     responses:
 *       200:
 *         description: Draft saved
 *       409:
 *         description: Under review or already approved
 * /riders/me/application/submit:
 *   post:
 *     tags: [Rider]
 *     summary: Submit the application for admin review
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status is now pending
 *       400:
 *         description: "Please complete: …"
 */
router.get("/me", checkAuth(...APP_ROLES), RiderProfileControllers.getMyRiderProfile);
router.put(
  "/me/application",
  checkAuth(...APP_ROLES),
  validateRequest(saveRiderApplicationZodSchema),
  RiderProfileControllers.saveApplication,
);
/**
 * @openapi
 * /riders/me/application:
 *   delete:
 *     tags: [Rider]
 *     summary: Delete my application while it is still a draft (never sent)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deleted; the profile shows "Become a rider" again
 *       400:
 *         description: Already sent (RIDER_APPLICATION_NOT_DRAFT)
 */
router.delete("/me/application", checkAuth(...APP_ROLES), RiderProfileControllers.deleteDraftApplication);
router.post(
  "/me/application/submit",
  checkAuth(...APP_ROLES),
  RiderProfileControllers.submitApplication,
);
router.patch(
  "/me",
  checkAuth(UserRole.rider),
  validateRequest(updateMyRiderProfileZodSchema),
  RiderProfileControllers.updateMyRiderProfile,
);

/**
 * @swagger
 * /riders/search:
 *   get:
 *     tags: [Rider]
 *     summary: Vendors find approved riders to invite (name or exact phone; phone is never returned)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/searchTerm'
 *       - { in: query, name: cityArea, schema: { type: string } }
 *       - { in: query, name: partnerType, schema: { type: string, enum: [moto, transit], default: moto } }
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Online riders first, then by rating
 */
router.get("/search", checkAuth(UserRole.vendor), RiderProfileControllers.searchRiders);

// ──────────────────────────────
// Admin (/riders/admin…)
// ──────────────────────────────

/**
 * @swagger
 * /riders/admin:
 *   get:
 *     tags: [Rider — Admin]
 *     summary: All delivery partner profiles / applications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: approvalStatus, schema: { type: string, enum: [draft, pending, approved, rejected, needs_changes, suspended] } }
 *       - { in: query, name: partnerType, schema: { type: string, enum: [moto, transit] } }
 *       - $ref: '#/components/parameters/searchTerm'
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Paginated riders with owner info
 * /riders/admin/{id}:
 *   get:
 *     tags: [Rider — Admin]
 *     summary: Full rider details — documents, history, payout methods, cash owed
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Rider
 * /riders/admin/{id}/review:
 *   patch:
 *     tags: [Rider — Admin]
 *     summary: Approve / reject / request changes / suspend / reinstate (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReviewApplicationRequest'
 *     responses:
 *       200:
 *         description: New status
 * /riders/admin/{id}/documents/{docId}:
 *   patch:
 *     tags: [Rider — Admin]
 *     summary: Mark one KYC document verified / rejected (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *       - { in: path, name: docId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReviewDocumentRequest'
 *     responses:
 *       200:
 *         description: Updated
 */
router.get("/admin", checkAuth(...ADMIN_ROLES), RiderProfileControllers.getRidersForAdmin);
router.get("/admin/:id", checkAuth(...ADMIN_ROLES), RiderProfileControllers.getRiderForAdmin);
router.patch(
  "/admin/:id/review",
  checkAuth(...manageRoles),
  validateRequest(reviewApplicationZodSchema),
  RiderProfileControllers.reviewApplication,
);
router.patch(
  "/admin/:id/documents/:docId",
  checkAuth(...manageRoles),
  validateRequest(reviewDocumentZodSchema),
  RiderProfileControllers.reviewDocument,
);

export const RiderProfileRoutes = router;

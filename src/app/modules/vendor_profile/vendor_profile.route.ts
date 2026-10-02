import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import {
  reviewApplicationZodSchema,
  reviewDocumentZodSchema,
} from "../profile_common/profile.common";
import { ADMIN_ROLES, APP_ROLES, UserRole } from "../user/user.interface";
import { VendorProfileControllers } from "./vendor_profile.controller";
import {
  saveVendorApplicationZodSchema,
  updateAvailabilityZodSchema,
  updateMyStoreZodSchema,
} from "./vendor_profile.validation";

const router = Router();
const manageRoles = [UserRole.admin, UserRole.super_admin];

// ──────────────────────────────
// Applicant / vendor (/vendors/me…)
// ──────────────────────────────

/**
 * @swagger
 * /vendors/me:
 *   get:
 *     tags: [Vendor]
 *     summary: My vendor profile / application (any status)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vendor profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/VendorProfile'
 *       404:
 *         description: No application yet
 *   patch:
 *     tags: [Vendor]
 *     summary: Update store details (approved vendors)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 * /vendors/me/application:
 *   put:
 *     tags: [Vendor]
 *     summary: Save the "Become a Vendor" application draft (any subset of fields, call per screen)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VendorApplicationRequest'
 *     responses:
 *       200:
 *         description: Draft saved
 *       409:
 *         description: Under review or already approved
 * /vendors/me/application/submit:
 *   post:
 *     tags: [Vendor]
 *     summary: Submit the application for admin review
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status is now pending
 *       400:
 *         description: "Please complete: …"
 * /vendors/me/availability:
 *   patch:
 *     tags: [Vendor]
 *     summary: Open/closed toggle and store hours (approved vendors)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isOpen: { type: boolean }
 *               availability:
 *                 type: object
 *                 properties:
 *                   enabled: { type: boolean }
 *                   days: { type: array, items: { type: string, enum: [mon, tue, wed, thu, fri, sat, sun] } }
 *                   openTime: { type: string, example: "11:00" }
 *                   closeTime: { type: string, example: "21:00" }
 *     responses:
 *       200:
 *         description: Updated
 */
router.get("/me", checkAuth(...APP_ROLES), VendorProfileControllers.getMyVendorProfile);
router.put(
  "/me/application",
  checkAuth(...APP_ROLES),
  validateRequest(saveVendorApplicationZodSchema),
  VendorProfileControllers.saveApplication,
);
router.post(
  "/me/application/submit",
  checkAuth(...APP_ROLES),
  VendorProfileControllers.submitApplication,
);
router.patch(
  "/me",
  checkAuth(UserRole.vendor),
  validateRequest(updateMyStoreZodSchema),
  VendorProfileControllers.updateMyStore,
);
router.patch(
  "/me/availability",
  checkAuth(UserRole.vendor),
  validateRequest(updateAvailabilityZodSchema),
  VendorProfileControllers.updateAvailability,
);

// ──────────────────────────────
// Admin (/vendors/admin…)
// ──────────────────────────────

/**
 * @swagger
 * /vendors/admin:
 *   get:
 *     tags: [Vendor — Admin]
 *     summary: All vendor profiles / applications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: approvalStatus, schema: { type: string, enum: [draft, pending, approved, rejected, needs_changes, suspended] } }
 *       - $ref: '#/components/parameters/searchTerm'
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Paginated vendors with owner info
 * /vendors/admin/{id}:
 *   get:
 *     tags: [Vendor — Admin]
 *     summary: Full vendor details — documents, history, payout methods
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Vendor
 * /vendors/admin/{id}/review:
 *   patch:
 *     tags: [Vendor — Admin]
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
 *       409:
 *         description: Action not allowed from the current status
 * /vendors/admin/{id}/documents/{docId}:
 *   patch:
 *     tags: [Vendor — Admin]
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
router.get("/admin", checkAuth(...ADMIN_ROLES), VendorProfileControllers.getVendorsForAdmin);
router.get("/admin/:id", checkAuth(...ADMIN_ROLES), VendorProfileControllers.getVendorForAdmin);
router.patch(
  "/admin/:id/review",
  checkAuth(...manageRoles),
  validateRequest(reviewApplicationZodSchema),
  VendorProfileControllers.reviewApplication,
);
router.patch(
  "/admin/:id/documents/:docId",
  checkAuth(...manageRoles),
  validateRequest(reviewDocumentZodSchema),
  VendorProfileControllers.reviewDocument,
);

// ──────────────────────────────
// Public (/vendors…)
// ──────────────────────────────

/**
 * @swagger
 * /vendors:
 *   get:
 *     tags: [Vendor]
 *     summary: Approved stores (public). No phone / email is exposed.
 *     parameters:
 *       - $ref: '#/components/parameters/searchTerm'
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *       - { in: query, name: isOpen, schema: { type: boolean } }
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Paginated stores
 * /vendors/{id}:
 *   get:
 *     tags: [Vendor]
 *     summary: One approved store (public)
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Store
 *       404:
 *         description: Not found
 */
router.get("/", VendorProfileControllers.getPublicVendors);
router.get("/:id", VendorProfileControllers.getPublicVendor);

export const VendorProfileRoutes = router;

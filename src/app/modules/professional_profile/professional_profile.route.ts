import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { reviewApplicationZodSchema } from "../profile_common/profile.common";
import { ADMIN_ROLES, APP_ROLES, UserRole } from "../user/user.interface";
import { BookingControllers } from "../booking/booking.controller";
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
/**
 * @swagger
 * /professional-profiles/workers/{id}/reviews:
 *   get:
 *     tags: [Professional Profile]
 *     summary: A worker's reviews from completed bookings (stars, comment, work photos); meta.stars = count per rating
 */
router.get("/workers/:id/reviews", BookingControllers.getWorkerReviews);

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

/**
 * @swagger
 * /professional-profiles/me/cv:
 *   delete:
 *     tags: [Professional Profile]
 *     summary: Delete my CV (text, skills, education, experience, imported and Kadou24h CV files)
 *     description: |
 *       A worker (applied or listed) keeps the trade, photo and city of their worker page;
 *       the paid visibility, ratings and worker review stay. To remove only one file, send
 *       `uploadedResume: null` or `generatedCv: null` to PUT /me. Recruiters keep the copy
 *       sent with an earlier application.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The profile after deleting
 */
router.delete("/me/cv", checkAuth(...APP_ROLES), ProfessionalProfileControllers.deleteMyCv);

router.patch(
  "/me/worker-listing",
  checkAuth(...APP_ROLES),
  validateRequest(toggleWorkerListingSchema),
  ProfessionalProfileControllers.toggleWorkerListing,
);

/**
 * @swagger
 * /professional-profiles/me/worker-application/submit:
 *   post:
 *     tags: [Professional Profile]
 *     summary: Send my worker profile for admin review (Become a worker)
 *     description: Needs photo, profession, serviceCategoryId, experienceYears, hourlyRate, city, summary (≥ 20 chars), at least one skill and idDocument (400 lists what is missing). Allowed from draft, rejected or needs_changes. Customers see the worker only once approved.
 *     security: [{ bearerAuth: [] }]
 * /professional-profiles/me/worker-summary:
 *   get:
 *     tags: [Professional Profile]
 *     summary: Worker home — approval status, customer chats (count, unread, latest 5) and rating
 *     security: [{ bearerAuth: [] }]
 */
router.post("/me/worker-application/submit", checkAuth(...APP_ROLES), ProfessionalProfileControllers.submitWorkerApplication);
router.get("/me/worker-summary", checkAuth(...APP_ROLES), ProfessionalProfileControllers.getWorkerSummary);

/**
 * @swagger
 * /professional-profiles/admin/workers:
 *   get:
 *     tags: [Professional Profile]
 *     summary: Worker applications (admin) — ?status=pending|approved|rejected|needs_changes|suspended&search=; meta.counts per status
 *     security: [{ bearerAuth: [] }]
 * /professional-profiles/admin/workers/{id}:
 *   get:
 *     tags: [Professional Profile]
 *     summary: One worker application with the ID document and history (admin)
 *     security: [{ bearerAuth: [] }]
 * /professional-profiles/admin/workers/{id}/review:
 *   patch:
 *     tags: [Professional Profile]
 *     summary: Approve / reject / request changes / suspend / reinstate a worker (admin; a note is required except to approve or reinstate)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/admin/workers", checkAuth(...ADMIN_ROLES), ProfessionalProfileControllers.getWorkersForAdmin);
router.get("/admin/workers/:id", checkAuth(...ADMIN_ROLES), ProfessionalProfileControllers.getWorkerForAdmin);
router.patch(
  "/admin/workers/:id/review",
  checkAuth(UserRole.admin, UserRole.super_admin),
  validateRequest(reviewApplicationZodSchema),
  ProfessionalProfileControllers.reviewWorker,
);

router.post(
  "/me/generate-ai-cv",
  checkAuth(...APP_ROLES),
  validateRequest(generateAiCvSchema),
  ProfessionalProfileControllers.generateAiCv,
);

export const ProfessionalProfileRoutes = router;

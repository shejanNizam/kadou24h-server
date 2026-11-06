import { Router } from "express";
import { checkAuth, optionalAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, APP_ROLES, UserRole } from "../user/user.interface";
import { JobControllers } from "./job.controller";
import {
  applyJobSchema,
  applySpontaneousSchema,
  createJobSchema,
  publishJobSchema,
  removeJobSchema,
  scheduleInterviewSchema,
  updateApplicationStatusSchema,
  unlockCvSchema,
  updateJobSchema,
} from "./job.validation";

const router = Router();
const staff = checkAuth(...ADMIN_ROLES);
const admin = checkAuth(UserRole.admin, UserRole.super_admin);

/**
 * @swagger
 * /jobs/admin:
 *   get:
 *     tags: [Jobs]
 *     summary: Admin — every job offer with its poster (state live|draft|unpaid|expired|closed|removed, search by title / organization / city / poster name, phone or email; meta.counts per state)
 *     security: [{ bearerAuth: [] }]
 * /jobs/admin/{id}:
 *   get:
 *     tags: [Jobs]
 *     summary: Admin — one job offer with its poster, publish payment, application counts and removal
 *     security: [{ bearerAuth: [] }]
 * /jobs/admin/{id}/applications:
 *   get:
 *     tags: [Jobs]
 *     summary: Admin — the job's applications with the candidates' contact
 *     security: [{ bearerAuth: [] }]
 * /jobs/admin/{id}/remove:
 *   patch:
 *     tags: [Jobs]
 *     summary: Admin — take a job offer down (body { reason }); hidden everywhere, the poster and waiting candidates are told. No refund.
 *     security: [{ bearerAuth: [] }]
 * /jobs/admin/{id}/restore:
 *   patch:
 *     tags: [Jobs]
 *     summary: Admin — put a removed offer back as it was (a published one gets back the days it spent removed)
 *     security: [{ bearerAuth: [] }]
 */
// Before "/:id", which would swallow "/admin"
router.get("/admin", staff, JobControllers.getJobsForAdmin);
router.get("/admin/:id", staff, JobControllers.getJobForAdmin);
router.get("/admin/:id/applications", staff, JobControllers.getJobApplicationsForAdmin);
router.patch("/admin/:id/remove", admin, validateRequest(removeJobSchema), JobControllers.removeJob);
router.patch("/admin/:id/restore", admin, JobControllers.restoreJob);

// Public Job Search & Details
router.get("/", JobControllers.searchJobs);
/**
 * @swagger
 * /jobs/my:
 *   get:
 *     tags: [Jobs]
 *     summary: Recruiter - my posted jobs (any status) and the counts for the operations home
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: tab, schema: { type: string, enum: [active, draft, closed] }, description: "active = published and not expired; draft = draft or unpaid; closed = closed or past 30 days" }
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Jobs (with isOpen); meta.counts = { active, draft, closed, applicants, views }
 */
router.get("/my", checkAuth(...APP_ROLES), JobControllers.getMyJobs);
// Signed in or not: a signed-in viewer also gets isOwner + myApplication; drafts only for their poster
router.get("/:id", optionalAuth, JobControllers.getJobDetails);

// Recruiter / Job Poster Operations
router.post(
  "/",
  checkAuth(...APP_ROLES),
  validateRequest(createJobSchema),
  JobControllers.createJob,
);

router.patch(
  "/:id",
  checkAuth(...APP_ROLES),
  validateRequest(updateJobSchema),
  JobControllers.updateJob,
);

router.post(
  "/:id/publish",
  checkAuth(...APP_ROLES),
  validateRequest(publishJobSchema),
  JobControllers.publishJob,
);

router.post(
  "/:id/close",
  checkAuth(...APP_ROLES),
  JobControllers.closeJob,
);

router.get(
  "/:id/applicants",
  checkAuth(...APP_ROLES),
  JobControllers.getJobApplicants,
);

router.patch(
  "/applications/:applicationId/status",
  checkAuth(...APP_ROLES),
  validateRequest(updateApplicationStatusSchema),
  JobControllers.updateApplicationStatus,
);

router.post(
  "/applications/:applicationId/interview",
  checkAuth(...APP_ROLES),
  validateRequest(scheduleInterviewSchema),
  JobControllers.scheduleInterview,
);

router.post(
  "/candidates/:applicantId/unlock-cv",
  checkAuth(...APP_ROLES),
  validateRequest(unlockCvSchema),
  JobControllers.unlockCandidateCv,
);

// Candidate Applications
router.post(
  "/apply",
  checkAuth(...APP_ROLES),
  validateRequest(applyJobSchema),
  JobControllers.applyToJob,
);

router.post(
  "/apply-spontaneous",
  checkAuth(...APP_ROLES),
  validateRequest(applySpontaneousSchema),
  JobControllers.applySpontaneous,
);

router.get(
  "/applications/my",
  checkAuth(...APP_ROLES),
  JobControllers.getMyApplications,
);

/**
 * @swagger
 * /jobs/applications/received:
 *   get:
 *     tags: [Jobs]
 *     summary: Vendor inbox of paid spontaneous applications (contact & CV file hidden until CV unlock)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [applied, under_review, shortlisted, interview, hired, rejected, withdrawn] } }
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Applications with applicant { name, avatar, phone?, email? } and isCvUnlocked
 */
router.get(
  "/applications/received",
  checkAuth(UserRole.vendor),
  JobControllers.getReceivedApplications,
);

/**
 * @swagger
 * /jobs/applications/{applicationId}:
 *   get:
 *     tags: [Jobs]
 *     summary: One application - the candidate's own (job + interview) or, for the recruiter, behind the CV paywall
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Application with viewerRole (candidate | recruiter)
 * /jobs/applications/{applicationId}/withdraw:
 *   patch:
 *     tags: [Jobs]
 *     summary: Candidate withdraws (while applied / under review / shortlisted / interview); the recruiter is told
 *     security:
 *       - bearerAuth: []
 * /jobs/applications/{applicationId}/interview/confirm:
 *   post:
 *     tags: [Jobs]
 *     summary: Candidate confirms the scheduled interview; the recruiter is told
 *     security:
 *       - bearerAuth: []
 */
// After /applications/my and /applications/received, which this pattern would swallow
router.get("/applications/:applicationId", checkAuth(...APP_ROLES), JobControllers.getApplication);
router.patch("/applications/:applicationId/withdraw", checkAuth(...APP_ROLES), JobControllers.withdrawApplication);
router.post("/applications/:applicationId/interview/confirm", checkAuth(...APP_ROLES), JobControllers.confirmInterview);

export const JobRoutes = router;

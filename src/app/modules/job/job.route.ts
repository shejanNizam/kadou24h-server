import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { APP_ROLES } from "../user/user.interface";
import { JobControllers } from "./job.controller";
import {
  applyJobSchema,
  applySpontaneousSchema,
  createJobSchema,
  publishJobSchema,
  scheduleInterviewSchema,
  updateApplicationStatusSchema,
  updateJobSchema,
} from "./job.validation";

const router = Router();

// Public Job Search & Details
router.get("/", JobControllers.searchJobs);
router.get("/:id", JobControllers.getJobDetails);

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

export const JobRoutes = router;

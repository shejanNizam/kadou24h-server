import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { emitToUser } from "../../../socket/socket";
import { PaymentMethod, PaymentPurpose } from "../payment/payment.interface";
import { PaymentServices } from "../payment/payment.service";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import {
  ApplicationKind,
  ApplicationStatus,
  IJob,
  IJobApplication,
  JobStatus,
} from "./job.interface";
import { Job } from "./job.model";
import { JobApplication } from "./job_application.model";

/**
 * Calculates a match score (0–100%) between an applicant's skills and a job's preferences.
 */
const calculateMatchScore = (
  applicantSkills: string[] = [],
  jobPrefSkills: string[] = [],
  applicantLanguages: string[] = [],
  jobPrefLanguages: string[] = [],
): number => {
  if (jobPrefSkills.length === 0 && jobPrefLanguages.length === 0) {
    return 100; // Open to all candidates
  }

  const normAppSkills = new Set(
    applicantSkills.map((s) => s.toLowerCase().trim()),
  );
  const normAppLangs = new Set(
    applicantLanguages.map((l) => l.toLowerCase().trim()),
  );

  let skillScore = 100;
  if (jobPrefSkills.length > 0) {
    const matchedSkills = jobPrefSkills.filter((s) =>
      normAppSkills.has(s.toLowerCase().trim()),
    );
    skillScore = Math.round((matchedSkills.length / jobPrefSkills.length) * 100);
  }

  let langScore = 100;
  if (jobPrefLanguages.length > 0) {
    const matchedLangs = jobPrefLanguages.filter((l) =>
      normAppLangs.has(l.toLowerCase().trim()),
    );
    langScore = Math.round((matchedLangs.length / jobPrefLanguages.length) * 100);
  }

  if (jobPrefSkills.length > 0 && jobPrefLanguages.length > 0) {
    return Math.round(skillScore * 0.8 + langScore * 0.2);
  }
  return jobPrefSkills.length > 0 ? skillScore : langScore;
};

/**
 * Creates a job post in draft mode.
 */
const createJob = async (
  userId: string,
  postedByMode: string,
  payload: Partial<IJob> & { location?: { lat: number; lng: number } },
) => {
  const { location, categoryId, ...rest } = payload;

  const job = await Job.create({
    ...rest,
    postedBy: new Types.ObjectId(userId),
    postedByMode,
    categoryId: categoryId ? new Types.ObjectId(categoryId) : undefined,
    location: location ? toGeoPoint(location) : undefined,
    status: JobStatus.draft,
    isDeleted: false,
    stats: { views: 0, applicants: 0, shortlisted: 0, interviews: 0 },
  });

  return job;
};

/**
 * Updates a job post.
 */
const updateJob = async (
  userId: string,
  jobId: string,
  payload: Partial<IJob> & { location?: { lat: number; lng: number } },
) => {
  const job = await Job.findOne({ _id: jobId, postedBy: userId, isDeleted: false });
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Job not found");

  const { location, categoryId, ...rest } = payload;
  if (location) job.location = toGeoPoint(location);
  if (categoryId) job.categoryId = new Types.ObjectId(categoryId);

  job.set(rest);
  await job.save();
  return job;
};

/**
 * Publishes a job post with the 5,000 GNF publishing payment.
 * Automatically activates the job for a 30-day period.
 */
const publishJob = async (
  userId: string,
  jobId: string,
  paymentMethod: PaymentMethod,
) => {
  const job = await Job.findOne({ _id: jobId, postedBy: userId, isDeleted: false });
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Job not found");

  if (job.status === JobStatus.published && job.expiresAt && job.expiresAt > new Date()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Job is already published");
  }

  // 1. Process 5,000 GNF publishing payment
  const payment = await PaymentServices.initiatePayment(userId, {
    purpose: PaymentPurpose.job_publish,
    refId: String(job._id),
    method: paymentMethod,
  });

  // 2. Set job to published for 30 days
  job.status = JobStatus.published;
  job.publishedAt = new Date();
  job.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  job.publishPaymentId = payment._id;
  await job.save();

  return { job, payment };
};

/**
 * Closes a job post.
 */
const closeJob = async (userId: string, jobId: string) => {
  const job = await Job.findOne({ _id: jobId, postedBy: userId, isDeleted: false });
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Job not found");

  job.status = JobStatus.closed;
  await job.save();
  return job;
};

/**
 * Public search for active jobs.
 */
const searchJobs = async (query: {
  search?: string;
  categoryId?: string;
  jobType?: string;
  workplace?: string;
  city?: string;
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    status: JobStatus.published,
    isDeleted: false,
    expiresAt: { $gt: new Date() },
  };

  if (query.categoryId) {
    filter.categoryId = new Types.ObjectId(query.categoryId);
  }
  if (query.jobType) filter.jobType = query.jobType;
  if (query.workplace) filter.workplace = query.workplace;
  if (query.city) filter.city = { $regex: query.city, $options: "i" };

  if (query.search) {
    filter.$text = { $search: query.search };
  }

  if (query.lat !== undefined && query.lng !== undefined) {
    const radiusKm = query.maxDistanceKm ? Number(query.maxDistanceKm) : 50;
    const earthRadiusKm = 6378.1;
    filter.location = {
      $geoWithin: {
        $centerSphere: [
          [Number(query.lng), Number(query.lat)],
          radiusKm / earthRadiusKm,
        ],
      },
    };
  }

  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .populate("categoryId", "name slug")
      .populate("postedBy", "name avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Job.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: jobs,
  };
};

/**
 * Public view of a single job. Increments views count.
 */
const getJobDetails = async (jobId: string, viewerId?: string) => {
  const job = await Job.findOne({ _id: jobId, isDeleted: false })
    .populate("categoryId", "name slug")
    .populate("postedBy", "name avatar");

  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Job not found");

  // Increment views if viewer is not the creator
  if (viewerId && String(job.postedBy._id) !== viewerId) {
    job.stats.views = (job.stats.views || 0) + 1;
    await job.save();
  }

  return job;
};

/**
 * Applies to a published job (offer kind).
 */
const applyToJob = async (
  applicantId: string,
  payload: {
    jobId: string;
    resume?: { url: string; publicId: string };
    coverNote?: string;
  },
) => {
  const job = await Job.findOne({
    _id: payload.jobId,
    status: JobStatus.published,
    isDeleted: false,
    expiresAt: { $gt: new Date() },
  });

  if (!job) {
    throw new AppError(httpStatus.NOT_FOUND, "Job is not available for applications");
  }

  if (String(job.postedBy) === applicantId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Cannot apply to your own job");
  }

  const profile = await ProfessionalProfile.findOne({ userId: applicantId });

  // Calculate match percentage
  const matchScore = calculateMatchScore(
    profile?.skills || [],
    job.prefSkills || [],
    profile?.languages || [],
    job.prefLanguages || [],
  );

  // Snapshot CV at apply time
  const cvSnapshot = {
    file: payload.resume || profile?.uploadedResume || profile?.generatedCv,
    profession: profile?.profession,
    skills: profile?.skills || [],
    summary: payload.coverNote || profile?.summary,
  };

  const application = await JobApplication.create({
    kind: ApplicationKind.offer,
    jobId: job._id,
    applicantId: new Types.ObjectId(applicantId),
    cvSnapshot,
    matchScore,
    status: ApplicationStatus.applied,
  });

  // Increment job applicants count
  job.stats.applicants = (job.stats.applicants || 0) + 1;
  await job.save();

  emitToUser(String(job.postedBy), "job_application:new", {
    jobId: job._id,
    applicationId: application._id,
    matchScore,
  });

  return application;
};

/**
 * Spontaneous application sent directly to a vendor.
 */
const applySpontaneous = async (
  applicantId: string,
  payload: {
    targetVendorId: string;
    resume?: { url: string; publicId: string };
    coverNote?: string;
    paymentMethod: PaymentMethod;
  },
) => {
  const vendor = await VendorProfile.findById(payload.targetVendorId);
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Vendor not found");

  const profile = await ProfessionalProfile.findOne({ userId: applicantId });

  const payment = await PaymentServices.initiatePayment(applicantId, {
    purpose: PaymentPurpose.spontaneous_application,
    refId: String(vendor._id),
    method: payload.paymentMethod,
  });

  const cvSnapshot = {
    file: payload.resume || profile?.uploadedResume || profile?.generatedCv,
    profession: profile?.profession,
    skills: profile?.skills || [],
    summary: payload.coverNote || profile?.summary,
  };

  const application = await JobApplication.create({
    kind: ApplicationKind.spontaneous,
    targetVendorId: vendor._id,
    applicantId: new Types.ObjectId(applicantId),
    cvSnapshot,
    matchScore: 100,
    status: ApplicationStatus.applied,
    paymentId: payment._id,
  });

  emitToUser(String(vendor.userId), "job_application:new", {
    vendorId: vendor._id,
    applicationId: application._id,
    kind: ApplicationKind.spontaneous,
  });

  return { application, payment };
};

/**
 * Recruiter lists applicants for their job with sorting by match score or date.
 */
const getJobApplicants = async (
  recruiterId: string,
  jobId: string,
  query: { page?: number; limit?: number; status?: ApplicationStatus; sortBy?: "match" | "date" },
) => {
  const job = await Job.findOne({ _id: jobId, postedBy: recruiterId });
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Job not found or unauthorized");

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { jobId: job._id };
  if (query.status) filter.status = query.status;

  const sort: Record<string, 1 | -1> =
    query.sortBy === "match" ? { matchScore: -1, createdAt: -1 } : { createdAt: -1 };

  const [applications, total] = await Promise.all([
    JobApplication.find(filter)
      .populate("applicantId", "name avatar phone email")
      .sort(sort)
      .skip(skip)
      .limit(limit),
    JobApplication.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: applications,
  };
};

/**
 * Recruiter updates applicant status (shortlisted, rejected, hired).
 */
const updateApplicationStatus = async (
  recruiterId: string,
  applicationId: string,
  status: ApplicationStatus,
) => {
  const application = await JobApplication.findById(applicationId);
  if (!application) throw new AppError(httpStatus.NOT_FOUND, "Application not found");

  if (application.jobId) {
    const job = await Job.findOne({ _id: application.jobId, postedBy: recruiterId });
    if (!job) throw new AppError(httpStatus.FORBIDDEN, "Not authorized to manage this application");

    if (status === ApplicationStatus.shortlisted && application.status !== ApplicationStatus.shortlisted) {
      job.stats.shortlisted = (job.stats.shortlisted || 0) + 1;
      await job.save();
    }
  }

  application.status = status;
  await application.save();

  emitToUser(String(application.applicantId), "job_application:status_changed", {
    applicationId: application._id,
    status,
  });

  return application;
};

/**
 * Recruiter schedules an interview.
 */
const scheduleInterview = async (
  recruiterId: string,
  applicationId: string,
  payload: { at: string | Date; location?: string; mapUrl?: string; note?: string },
) => {
  const application = await JobApplication.findById(applicationId);
  if (!application) throw new AppError(httpStatus.NOT_FOUND, "Application not found");

  if (application.jobId) {
    const job = await Job.findOne({ _id: application.jobId, postedBy: recruiterId });
    if (!job) throw new AppError(httpStatus.FORBIDDEN, "Not authorized to manage this application");

    job.stats.interviews = (job.stats.interviews || 0) + 1;
    await job.save();
  }

  application.status = ApplicationStatus.interview;
  application.interview = {
    at: new Date(payload.at),
    location: payload.location,
    mapUrl: payload.mapUrl,
    note: payload.note,
  };
  await application.save();

  emitToUser(String(application.applicantId), "job_application:interview_scheduled", {
    applicationId: application._id,
    interview: application.interview,
  });

  return application;
};

/**
 * Candidate lists their submitted applications.
 */
const getMyApplications = async (
  applicantId: string,
  query: { page?: number; limit?: number; status?: ApplicationStatus },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    applicantId: new Types.ObjectId(applicantId),
  };
  if (query.status) filter.status = query.status;

  const [applications, total] = await Promise.all([
    JobApplication.find(filter)
      .populate("jobId", "title organizationName organizationLogo city salaryMin salaryMax")
      .populate("targetVendorId", "storeName logo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    JobApplication.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: applications,
  };
};

/**
 * Recruiter candidate CV unlock (10,000 GNF).
 */
const unlockCandidateCv = async (
  recruiterId: string,
  applicantId: string,
  paymentMethod: PaymentMethod,
) => {
  const payment = await PaymentServices.initiatePayment(recruiterId, {
    purpose: PaymentPurpose.cv_unlock,
    refId: applicantId,
    method: paymentMethod,
  });

  return { unlocked: true, payment };
};

export const JobServices = {
  calculateMatchScore,
  createJob,
  updateJob,
  publishJob,
  closeJob,
  searchJobs,
  getJobDetails,
  applyToJob,
  applySpontaneous,
  getJobApplicants,
  updateApplicationStatus,
  scheduleInterview,
  getMyApplications,
  unlockCandidateCv,
};

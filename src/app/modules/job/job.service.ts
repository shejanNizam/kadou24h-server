import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { emitToUser } from "../../../socket/socket";
import { Notify } from "../notification/notification.events";
import { AppMode } from "../user/user.interface";
import { PaymentMethod, PaymentPurpose, PaymentStatus } from "../payment/payment.interface";
import { Payment } from "../payment/payment.model";
import { PaymentServices } from "../payment/payment.service";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { ApprovalStatus } from "../profile_common/profile.common";
import { User } from "../user/user.model";
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
import { containsRegex } from "../../utils/queryParams";

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

  const isPaid = payment.status === PaymentStatus.success;

  // 2. Set job to published for 30 days only if payment is confirmed; otherwise pending_payment
  job.status = isPaid ? JobStatus.published : JobStatus.pending_payment;
  if (isPaid) {
    job.publishedAt = new Date();
    job.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
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
  if (query.city) filter.city = containsRegex(query.city);

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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: jobs,
  };
};

/**
 * Public view of a single job. Increments views count.
 * Drafts and unpaid jobs are only visible to their poster; closed / expired
 * jobs stay readable (candidates open them from their applications).
 * A signed-in viewer also gets `myApplication` (to show "Applied" instead of Apply).
 */
const getJobDetails = async (jobId: string, viewerId?: string) => {
  const job = await Job.findOne({ _id: jobId, isDeleted: false })
    .populate("categoryId", "name slug")
    .populate("postedBy", "name avatar");

  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Job not found");

  const isOwner = Boolean(viewerId && String(job.postedBy._id) === viewerId);
  if (!isOwner && [JobStatus.draft, JobStatus.pending_payment].includes(job.status)) {
    throw new AppError(httpStatus.NOT_FOUND, "Job not found");
  }

  // Increment views if viewer is not the creator
  if (viewerId && !isOwner) {
    job.stats.views = (job.stats.views || 0) + 1;
    await job.save();
  }

  const mine = viewerId && !isOwner
    ? await JobApplication.findOne({ jobId: job._id, applicantId: viewerId }).select("status createdAt")
    : null;

  return {
    ...job.toObject(),
    isOwner,
    isOpen: isOpenForApplications(job),
    myApplication: mine ? { _id: mine._id, status: mine.status, createdAt: mine.get("createdAt") } : null,
  };
};

const isOpenForApplications = (job: IJob) =>
  job.status === JobStatus.published && Boolean(job.expiresAt && job.expiresAt > new Date());

// Recruiter's "my jobs" tabs; a published job past its 30 days counts as closed
const MY_JOB_TABS = {
  active: () => ({ status: JobStatus.published, expiresAt: { $gt: new Date() } }),
  draft: () => ({ status: { $in: [JobStatus.draft, JobStatus.pending_payment] } }),
  closed: () => ({
    $or: [
      { status: { $in: [JobStatus.closed, JobStatus.expired] } },
      { status: JobStatus.published, expiresAt: { $lte: new Date() } },
    ],
  }),
} as const;
export type MyJobsTab = keyof typeof MY_JOB_TABS;

/** Recruiter: my posted jobs (any status) + the counts for the operations home. */
const getMyJobs = async (userId: string, query: { tab?: MyJobsTab; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const base = { postedBy: new Types.ObjectId(userId), isDeleted: false };
  const filter = { ...base, ...(query.tab ? MY_JOB_TABS[query.tab]() : {}) };

  const [jobs, total, active, draft, closed, totals] = await Promise.all([
    Job.find(filter).populate("categoryId", "name slug").sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
    Job.countDocuments(filter),
    Job.countDocuments({ ...base, ...MY_JOB_TABS.active() }),
    Job.countDocuments({ ...base, ...MY_JOB_TABS.draft() }),
    Job.countDocuments({ ...base, ...MY_JOB_TABS.closed() }),
    Job.aggregate<{ applicants: number; views: number }>([
      { $match: base },
      { $group: { _id: null, applicants: { $sum: "$stats.applicants" }, views: { $sum: "$stats.views" } } },
    ]),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
      counts: { active, draft, closed, applicants: totals[0]?.applicants ?? 0, views: totals[0]?.views ?? 0 },
    },
    data: jobs.map((job) => ({ ...job.toObject(), isOpen: isOpenForApplications(job) })),
  };
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
  if (await JobApplication.exists({ jobId: job._id, applicantId })) {
    throw new AppError(httpStatus.CONFLICT, "You already applied to this job");
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
  Notify.applicationUpdate(
    job.postedBy,
    job.postedByMode as AppMode,
    {
      fr: `Nouvelle candidature pour « ${job.title} » (correspondance ${matchScore} %).`,
      en: `New application for "${job.title}" (${matchScore}% match).`,
    },
    { jobId: String(job._id), applicationId: String(application._id) },
  );

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
  const vendor = await VendorProfile.findOne({
    _id: payload.targetVendorId,
    approvalStatus: ApprovalStatus.approved,
  });
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Vendor not found");
  if (String(vendor.userId) === applicantId) {
    throw new AppError(httpStatus.BAD_REQUEST, "You cannot apply to your own store");
  }

  const profile = await ProfessionalProfile.findOne({ userId: applicantId });

  const cvSnapshot = {
    file: payload.resume || profile?.uploadedResume || profile?.generatedCv,
    profession: profile?.profession,
    skills: profile?.skills || [],
    summary: payload.coverNote || profile?.summary,
  };

  // Hidden from the vendor until the fee is paid (the payment webhook flips it to "applied")
  const application = await JobApplication.create({
    kind: ApplicationKind.spontaneous,
    targetVendorId: vendor._id,
    applicantId: new Types.ObjectId(applicantId),
    cvSnapshot,
    matchScore: 100,
    status: ApplicationStatus.pending_payment,
  });

  try {
    const payment = await PaymentServices.initiatePayment(applicantId, {
      purpose: PaymentPurpose.spontaneous_application,
      refId: String(application._id),
      contextId: String(vendor._id),
      method: payload.paymentMethod,
    });
    application.paymentId = payment._id as Types.ObjectId;
    await application.save();
    return { application, payment };
  } catch (error) {
    await application.deleteOne();
    throw error;
  }
};

// ──────────────────────────────
// Recruiter side — CV unlock paywall
// ──────────────────────────────

/** Applicants this recruiter has paid to unlock (successful cv_unlock payments). */
const getUnlockedApplicantIds = async (recruiterId: string, applicantIds: string[]) => {
  if (applicantIds.length === 0) return new Set<string>();
  const payments = await Payment.find({
    payerId: recruiterId,
    purpose: PaymentPurpose.cv_unlock,
    status: PaymentStatus.success,
    refId: { $in: applicantIds },
  }).select("refId");
  return new Set(payments.map((p) => String(p.refId)));
};

/**
 * What a recruiter may see of applicants: profile, skills and match score always;
 * phone, email and the CV file only after paying the CV-unlock fee.
 */
const withPaywall = async (recruiterId: string, applications: IJobApplication[]) => {
  const applicantIds = [...new Set(applications.map((a) => String(a.applicantId)))];
  const unlocked = await getUnlockedApplicantIds(recruiterId, applicantIds);

  const users = await User.find({ _id: { $in: applicantIds } }).select("name avatar phone email");
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return applications.map((application) => {
    const obj = application.toObject();
    const id = String(application.applicantId);
    const user = userById.get(id);
    const isUnlocked = unlocked.has(id);

    return {
      ...obj,
      applicantId: id,
      applicant: {
        _id: id,
        name: user?.name,
        avatar: user?.avatar,
        ...(isUnlocked && { phone: user?.phone, email: user?.email }),
      },
      cvSnapshot: isUnlocked ? obj.cvSnapshot : { ...obj.cvSnapshot, file: undefined },
      isCvUnlocked: isUnlocked,
    };
  });
};

/**
 * Throws unless the recruiter owns the application: the job poster for a job
 * application, or the store owner for a spontaneous one. Returns the job, if any.
 */
const assertCanManageApplication = async (recruiterId: string, application: IJobApplication) => {
  if (application.jobId) {
    const job = await Job.findOne({ _id: application.jobId, postedBy: recruiterId });
    if (!job) throw new AppError(httpStatus.FORBIDDEN, "Not authorized to manage this application");
    return job;
  }

  const vendor = await VendorProfile.findOne({ userId: recruiterId }).select("_id");
  if (!vendor || !application.targetVendorId?.equals(vendor._id as Types.ObjectId)) {
    throw new AppError(httpStatus.FORBIDDEN, "Not authorized to manage this application");
  }
  if (application.status === ApplicationStatus.pending_payment) {
    throw new AppError(httpStatus.NOT_FOUND, "Application not found");
  }
  return null;
};

/** Vendor's inbox of paid spontaneous applications. */
const getReceivedApplications = async (
  vendorUserId: string,
  query: { page?: number; limit?: number; status?: ApplicationStatus },
) => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId }).select("_id");
  if (!vendor) throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found");

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));

  const filter: Record<string, unknown> = {
    targetVendorId: vendor._id,
    status: query.status && query.status !== ApplicationStatus.pending_payment
      ? query.status
      : { $ne: ApplicationStatus.pending_payment },
  };

  const [applications, total] = await Promise.all([
    JobApplication.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    JobApplication.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: await withPaywall(vendorUserId, applications),
  };
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
    JobApplication.find(filter).sort(sort).skip(skip).limit(limit),
    JobApplication.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    // Contact details and CV file only for unlocked candidates
    data: await withPaywall(recruiterId, applications),
  };
};

const RECRUITER_STATUSES = [
  ApplicationStatus.under_review,
  ApplicationStatus.shortlisted,
  ApplicationStatus.hired,
  ApplicationStatus.rejected,
];

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

  const job = await assertCanManageApplication(recruiterId, application);
  // The recruiter decides; "interview" goes through scheduleInterview (date, place),
  // "withdrawn" is the candidate's own choice
  if (!RECRUITER_STATUSES.includes(status)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Use: under_review, shortlisted, hired or rejected (interview: schedule it)");
  }
  if (application.status === ApplicationStatus.withdrawn) {
    throw new AppError(httpStatus.BAD_REQUEST, "The candidate withdrew this application");
  }
  if (
    job &&
    status === ApplicationStatus.shortlisted &&
    application.status !== ApplicationStatus.shortlisted
  ) {
    job.stats.shortlisted = (job.stats.shortlisted || 0) + 1;
    await job.save();
  }

  application.status = status;
  await application.save();

  emitToUser(String(application.applicantId), "job_application:status_changed", {
    applicationId: application._id,
    status,
  });
  const statusText: Partial<Record<ApplicationStatus, { fr: string; en: string }>> = {
    [ApplicationStatus.under_review]: { fr: "est en cours d'examen", en: "is under review" },
    [ApplicationStatus.shortlisted]: { fr: "a été présélectionnée", en: "has been shortlisted" },
    [ApplicationStatus.hired]: { fr: "a été retenue — félicitations !", en: "was successful — congratulations!" },
    [ApplicationStatus.rejected]: { fr: "n'a pas été retenue", en: "was not selected" },
  };
  const text = statusText[status];
  if (text) {
    Notify.applicationUpdate(
      application.applicantId,
      AppMode.customer,
      { fr: `Votre candidature ${text.fr}.`, en: `Your application ${text.en}.` },
      { applicationId: String(application._id), status },
    );
  }

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

  const job = await assertCanManageApplication(recruiterId, application);
  if (application.status === ApplicationStatus.withdrawn) {
    throw new AppError(httpStatus.BAD_REQUEST, "The candidate withdrew this application");
  }
  // A new date for the same candidate is a reschedule, not one more interview
  if (job && application.status !== ApplicationStatus.interview) {
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
  const when = new Date(payload.at).toISOString();
  Notify.applicationUpdate(
    application.applicantId,
    AppMode.customer,
    {
      fr: `Entretien prévu le ${when.slice(0, 10)} à ${when.slice(11, 16)} UTC${payload.location ? ` — ${payload.location}` : ""}.`,
      en: `Interview scheduled on ${when.slice(0, 10)} at ${when.slice(11, 16)} UTC${payload.location ? ` — ${payload.location}` : ""}.`,
    },
    { applicationId: String(application._id), interviewAt: when },
  );

  return application;
};

/** Who receives a job application: the poster (in the mode they posted from) or the store. */
const recruiterOf = async (application: IJobApplication) => {
  if (application.jobId) {
    const job = await Job.findById(application.jobId).select("postedBy postedByMode title");
    return job ? { userId: job.postedBy, mode: (job.postedByMode as AppMode) || AppMode.customer, title: job.title } : null;
  }
  const vendor = await VendorProfile.findById(application.targetVendorId).select("userId");
  return vendor ? { userId: vendor.userId, mode: AppMode.vendor, title: undefined } : null;
};

/**
 * One application: the candidate sees their own (with the job and the
 * interview); the recruiter sees it behind the CV paywall.
 */
const getApplication = async (userId: string, applicationId: string) => {
  const application = await JobApplication.findById(applicationId)
    .populate("jobId", "title organizationName organizationLogo city area salaryMin salaryMax salaryFrequency salaryCurrency status expiresAt postedBy")
    .populate("targetVendorId", "storeName logo");
  if (!application) throw new AppError(httpStatus.NOT_FOUND, "Application not found");

  if (String(application.applicantId) === userId) {
    return { ...application.toObject(), viewerRole: "candidate" as const };
  }

  // Recruiter: the check works on ids, so read the raw ids under the populated docs
  const raw = await JobApplication.findById(applicationId);
  await assertCanManageApplication(userId, raw!);
  const [view] = await withPaywall(userId, [raw!]);
  return { ...view, jobId: application.jobId, targetVendorId: application.targetVendorId, viewerRole: "recruiter" as const };
};

/** Candidate takes their application back (not once hired or rejected). */
const withdrawApplication = async (applicantId: string, applicationId: string) => {
  const application = await JobApplication.findOneAndUpdate(
    {
      _id: applicationId,
      applicantId,
      status: { $in: [ApplicationStatus.applied, ApplicationStatus.under_review, ApplicationStatus.shortlisted, ApplicationStatus.interview] },
    },
    { $set: { status: ApplicationStatus.withdrawn } },
    { returnDocument: "after" },
  );
  if (!application) {
    throw new AppError(httpStatus.BAD_REQUEST, "This application can no longer be withdrawn");
  }

  const recruiter = await recruiterOf(application);
  if (recruiter) {
    emitToUser(String(recruiter.userId), "job_application:status_changed", { applicationId: application._id, status: application.status });
    Notify.applicationUpdate(
      recruiter.userId,
      recruiter.mode,
      recruiter.title
        ? { fr: `Un candidat a retiré sa candidature pour « ${recruiter.title} ».`, en: `A candidate withdrew their application for "${recruiter.title}".` }
        : { fr: "Un candidat a retiré sa candidature spontanée.", en: "A candidate withdrew their spontaneous application." },
      { applicationId: String(application._id), ...(application.jobId && { jobId: String(application.jobId) }), status: application.status },
    );
  }
  return application;
};

/** Candidate confirms they will come to the interview. */
const confirmInterview = async (applicantId: string, applicationId: string) => {
  const application = await JobApplication.findOneAndUpdate(
    { _id: applicationId, applicantId, status: ApplicationStatus.interview, "interview.at": { $exists: true } },
    { $set: { "interview.confirmedAt": new Date() } },
    { returnDocument: "after" },
  );
  if (!application) throw new AppError(httpStatus.BAD_REQUEST, "There is no interview to confirm");

  const recruiter = await recruiterOf(application);
  if (recruiter) {
    emitToUser(String(recruiter.userId), "job_application:status_changed", { applicationId: application._id, status: application.status });
    Notify.applicationUpdate(
      recruiter.userId,
      recruiter.mode,
      { fr: "Un candidat a confirmé sa présence à l'entretien.", en: "A candidate confirmed the interview." },
      { applicationId: String(application._id), ...(application.jobId && { jobId: String(application.jobId) }) },
    );
  }
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: applications,
  };
};

/**
 * Recruiter pays to unlock a candidate's contact details and CV file
 * (price: settings.pricing.cvUnlockFee). Only for candidates who applied to one
 * of the recruiter's jobs or sent a paid application to the recruiter's store.
 * Access is granted when the payment webhook confirms the payment.
 */
const unlockCandidateCv = async (
  recruiterId: string,
  applicantId: string,
  paymentMethod: PaymentMethod,
) => {
  const [myJobIds, myVendor] = await Promise.all([
    Job.find({ postedBy: recruiterId }).distinct("_id"),
    VendorProfile.findOne({ userId: recruiterId }).select("_id"),
  ]);

  const hasApplied = await JobApplication.exists({
    applicantId,
    status: { $ne: ApplicationStatus.pending_payment },
    $or: [
      { jobId: { $in: myJobIds } },
      ...(myVendor ? [{ targetVendorId: myVendor._id }] : []),
    ],
  });
  if (!hasApplied) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You can only unlock candidates who applied to your jobs or your store",
    );
  }

  const alreadyUnlocked = await getUnlockedApplicantIds(recruiterId, [applicantId]);
  if (alreadyUnlocked.has(applicantId)) {
    return { unlocked: true, payment: null };
  }

  const payment = await PaymentServices.initiatePayment(recruiterId, {
    purpose: PaymentPurpose.cv_unlock,
    refId: applicantId,
    method: paymentMethod,
  });

  return { unlocked: payment.status === PaymentStatus.success, payment };
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
  getReceivedApplications,
  getMyJobs,
  getApplication,
  withdrawApplication,
  confirmInterview,
};

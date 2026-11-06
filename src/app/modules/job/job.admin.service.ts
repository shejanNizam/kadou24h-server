/**
 * Job offers in the admin panel (client request, 2026-10-29): the team sees every
 * offer with its poster and applications, and can remove one (rules, fraud) or
 * bring it back. A removal is never a refund: the team refunds the publish fee
 * from Payments when it decides to.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { escapeRegex } from "../../utils/queryParams";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { Notify } from "../notification/notification.events";
import { Payment } from "../payment/payment.model";
import { AppMode } from "../user/user.interface";
import { User } from "../user/user.model";
import { ApplicationStatus, IJob, JobStatus } from "./job.interface";
import { Job } from "./job.model";
import { JobApplication } from "./job_application.model";

/** What the admin filters on; a published job past its 30 days is "expired" */
export const ADMIN_JOB_STATES = ["live", "draft", "unpaid", "expired", "closed", "removed"] as const;
export type AdminJobState = (typeof ADMIN_JOB_STATES)[number];

const STATE_FILTER: Record<AdminJobState, () => Record<string, unknown>> = {
  live: () => ({ status: JobStatus.published, expiresAt: { $gt: new Date() } }),
  draft: () => ({ status: JobStatus.draft }),
  unpaid: () => ({ status: JobStatus.pending_payment }),
  expired: () => ({
    $or: [{ status: JobStatus.expired }, { status: JobStatus.published, expiresAt: { $lte: new Date() } }],
  }),
  closed: () => ({ status: JobStatus.closed }),
  removed: () => ({ status: JobStatus.removed }),
};

const stateOf = (job: Pick<IJob, "status" | "expiresAt">): AdminJobState => {
  if (job.status === JobStatus.published) return job.expiresAt && job.expiresAt > new Date() ? "live" : "expired";
  if (job.status === JobStatus.pending_payment) return "unpaid";
  return job.status as AdminJobState;
};

/** Applications still waiting on the recruiter: their candidates hear about a removal */
const OPEN_APPLICATIONS = [
  ApplicationStatus.applied,
  ApplicationStatus.under_review,
  ApplicationStatus.shortlisted,
  ApplicationStatus.interview,
];

const POSTER = "name phone email avatar";

const getJobsForAdmin = async (query: { state?: string; search?: string; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const base: Record<string, unknown> = { isDeleted: false };

  const search = query.search?.trim();
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    const posters = await User.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] }).select("_id").limit(200).lean();
    base.$or = [{ title: rx }, { organizationName: rx }, { city: rx }, { postedBy: { $in: posters.map((u) => u._id) } }];
  }

  const state = ADMIN_JOB_STATES.find((s) => s === query.state);
  // A search $or and the "expired" $or must both hold
  const filter = state ? { $and: [base, STATE_FILTER[state]()] } : base;

  const [rows, total, ...counts] = await Promise.all([
    Job.find(filter)
      .populate("postedBy", POSTER)
      .populate("categoryId", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Job.countDocuments(filter),
    // Counts per state ignore the search, like the other admin lists
    ...ADMIN_JOB_STATES.map((s) => Job.countDocuments({ isDeleted: false, ...STATE_FILTER[s]() })),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
      counts: Object.fromEntries(ADMIN_JOB_STATES.map((s, i) => [s, counts[i]])),
    },
    data: rows.map((job) => ({ ...job, state: stateOf(job) })),
  };
};

const getJobForAdmin = async (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new AppError(httpStatus.NOT_FOUND, "JOB_NOT_FOUND");
  const job = await Job.findOne({ _id: id, isDeleted: false })
    .populate("postedBy", POSTER)
    .populate("categoryId", "name")
    .populate("removal.by", "name")
    .lean();
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "JOB_NOT_FOUND");

  const [publishPayment, byStatus] = await Promise.all([
    job.publishPaymentId ? Payment.findById(job.publishPaymentId).select("amount status method createdAt").lean() : null,
    JobApplication.aggregate<{ _id: ApplicationStatus; n: number }>([
      { $match: { jobId: job._id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
  ]);

  return {
    ...job,
    state: stateOf(job),
    publishPayment,
    applicationCounts: Object.fromEntries(byStatus.map((c) => [c._id, c.n])),
  };
};

/** The team sees every candidate with their contact (no CV paywall for the team) */
const getJobApplicationsForAdmin = async (id: string, query: { page?: number; limit?: number }) => {
  if (!Types.ObjectId.isValid(id)) throw new AppError(httpStatus.NOT_FOUND, "JOB_NOT_FOUND");
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const filter = { jobId: new Types.ObjectId(id) };

  const [rows, total] = await Promise.all([
    JobApplication.find(filter)
      .populate("applicantId", POSTER)
      .select("applicantId status matchScore cvSnapshot.profession cvSnapshot.skills interview.at createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    JobApplication.countDocuments(filter),
  ]);
  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, data: rows };
};

/** Tells the candidates still waiting on this job */
const tellOpenApplicants = async (job: IJob, message: { fr: string; en: string }) => {
  const open = await JobApplication.find({ jobId: job._id, status: { $in: OPEN_APPLICATIONS } }).select("applicantId").lean();
  for (const application of open) {
    Notify.applicationUpdate(application.applicantId, AppMode.customer, message, {
      applicationId: String(application._id),
      jobId: String(job._id),
    });
  }
};

/** Takes an offer down: hidden from search and candidates, frozen for its poster */
const removeJob = async (id: string, reason: string, actorId: string) => {
  const job = await Job.findOne({ _id: id, isDeleted: false });
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "JOB_NOT_FOUND");
  if (job.status === JobStatus.removed) throw new AppError(httpStatus.BAD_REQUEST, "JOB_ALREADY_REMOVED");

  const previousStatus = job.status;
  // Only if nobody changed it meanwhile (the recruiter closing it, another admin)
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, status: previousStatus },
    { $set: { status: JobStatus.removed, removal: { at: new Date(), by: new Types.ObjectId(actorId), reason, previousStatus } } },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError(httpStatus.CONFLICT, "CONFLICT");

  await AuditLogServices.record({
    actorId,
    action: "job.remove",
    targetType: "job",
    targetId: id,
    before: { status: previousStatus },
    after: { status: JobStatus.removed, reason },
  });
  Notify.jobModerated(updated.postedBy, (updated.postedByMode as AppMode) || AppMode.customer, updated, { removed: true, reason });
  await tellOpenApplicants(updated, {
    fr: `L'équipe Kadou24h a retiré l'offre « ${updated.title} ». Votre candidature n'est plus active.`,
    en: `The Kadou24h team removed the job offer "${updated.title}". Your application is no longer active.`,
  });
  return getJobForAdmin(id);
};

/**
 * Puts the offer back as it was. A published offer gets back the days it spent
 * removed (the poster paid for 30 days online).
 */
const restoreJob = async (id: string, actorId: string) => {
  const job = await Job.findOne({ _id: id, isDeleted: false });
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "JOB_NOT_FOUND");
  if (job.status !== JobStatus.removed || !job.removal) throw new AppError(httpStatus.BAD_REQUEST, "JOB_NOT_REMOVED");

  const { previousStatus, at } = job.removal;
  const set: Record<string, unknown> = { status: previousStatus };
  if (previousStatus === JobStatus.published && job.expiresAt) {
    set.expiresAt = new Date(job.expiresAt.getTime() + (Date.now() - at.getTime()));
  }
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, status: JobStatus.removed },
    { $set: set, $unset: { removal: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError(httpStatus.CONFLICT, "CONFLICT");

  await AuditLogServices.record({
    actorId,
    action: "job.restore",
    targetType: "job",
    targetId: id,
    before: { status: JobStatus.removed, reason: job.removal.reason },
    after: { status: previousStatus },
  });
  Notify.jobModerated(updated.postedBy, (updated.postedByMode as AppMode) || AppMode.customer, updated, { removed: false });
  if (stateOf(updated) === "live") {
    await tellOpenApplicants(updated, {
      fr: `L'offre « ${updated.title} » est de nouveau en ligne. Votre candidature est toujours active.`,
      en: `The job offer "${updated.title}" is back online. Your application is still active.`,
    });
  }
  return getJobForAdmin(id);
};

export const JobAdminServices = {
  getJobsForAdmin,
  getJobForAdmin,
  getJobApplicationsForAdmin,
  removeJob,
  restoreJob,
};

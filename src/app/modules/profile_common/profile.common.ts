/**
 * Shared by vendor_profile and rider_profile: approval workflow,
 * KYC documents and the role that approval grants.
 */
import httpStatus from "http-status";
import { Schema, Types } from "mongoose";
import z from "zod";
import { IFileRef } from "../../interfaces/common.types";
import AppError from "../../errorHelpers/AppError";
import { emitToUser } from "../../../socket/socket";
import { fileRefSchema, fileRefZodSchema } from "../../utils/commonSchemas";
import { AppMode, UserRole } from "../user/user.interface";
import { User } from "../user/user.model";

// ──────────────────────────────
// Types
// ──────────────────────────────

export enum ApprovalStatus {
  draft = "draft",
  pending = "pending",
  approved = "approved",
  rejected = "rejected",
  needs_changes = "needs_changes",
  suspended = "suspended",
}

export enum ReviewAction {
  approve = "approve",
  reject = "reject",
  needs_changes = "needs_changes",
  suspend = "suspend",
  reinstate = "reinstate",
}

export enum DocumentStatus {
  pending = "pending",
  verified = "verified",
  rejected = "rejected",
}

export interface IVerificationDocument {
  _id?: Types.ObjectId;
  type: string;
  file: IFileRef;
  status: DocumentStatus;
  note?: string;
}

export interface IApplicationHistory {
  action: string; // submitted | approve | reject | needs_changes | suspend | reinstate
  note?: string;
  byUserId: Types.ObjectId;
  at: Date;
}

export interface IReviewable {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  approvalStatus: ApprovalStatus;
  reviewNote?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  submittedAt?: Date;
  applicationHistory: IApplicationHistory[];
}

// ──────────────────────────────
// Mongoose sub-schemas
// ──────────────────────────────

export const verificationDocumentSchema = (types: string[]) =>
  new Schema<IVerificationDocument>({
    type: { type: String, enum: types, required: true },
    file: { type: fileRefSchema, required: true },
    status: { type: String, enum: Object.values(DocumentStatus), default: DocumentStatus.pending },
    note: { type: String },
  });

export const applicationHistorySchema = new Schema<IApplicationHistory>(
  {
    action: { type: String, required: true },
    note: { type: String },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

export const reviewFields = {
  approvalStatus: {
    type: String,
    enum: Object.values(ApprovalStatus),
    default: ApprovalStatus.draft,
  },
  reviewNote: { type: String },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reviewedAt: { type: Date },
  submittedAt: { type: Date },
  applicationHistory: { type: [applicationHistorySchema], default: [] },
};

// ──────────────────────────────
// Zod
// ──────────────────────────────

export const documentInputZodSchema = (types: [string, ...string[]]) =>
  z.object({ type: z.enum(types), file: fileRefZodSchema });

export const reviewApplicationZodSchema = z
  .object({
    action: z.enum(Object.values(ReviewAction) as [string, ...string[]]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action === ReviewAction.approve || v.action === ReviewAction.reinstate || !!v.note, {
    message: "A note is required to reject, request changes or suspend",
    path: ["note"],
  });

export const reviewDocumentZodSchema = z
  .object({
    status: z.enum([DocumentStatus.verified, DocumentStatus.rejected]),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.status !== DocumentStatus.rejected || !!v.note, {
    message: "A note is required when rejecting a document",
    path: ["note"],
  });

// ──────────────────────────────
// Workflow
// ──────────────────────────────

// Statuses from which the applicant may edit and (re)submit
export const EDITABLE_STATUSES = [
  ApprovalStatus.draft,
  ApprovalStatus.needs_changes,
  ApprovalStatus.rejected,
];

const TRANSITIONS: Record<ReviewAction, { from: ApprovalStatus[]; to: ApprovalStatus }> = {
  [ReviewAction.approve]: { from: [ApprovalStatus.pending], to: ApprovalStatus.approved },
  [ReviewAction.reject]: { from: [ApprovalStatus.pending], to: ApprovalStatus.rejected },
  [ReviewAction.needs_changes]: { from: [ApprovalStatus.pending], to: ApprovalStatus.needs_changes },
  [ReviewAction.suspend]: { from: [ApprovalStatus.approved], to: ApprovalStatus.suspended },
  [ReviewAction.reinstate]: { from: [ApprovalStatus.suspended], to: ApprovalStatus.approved },
};

export const assertEditable = (profile: IReviewable) => {
  if (profile.approvalStatus === ApprovalStatus.pending) {
    throw new AppError(httpStatus.CONFLICT, "Your application is under review and cannot be edited now");
  }
  if (!EDITABLE_STATUSES.includes(profile.approvalStatus)) {
    throw new AppError(httpStatus.CONFLICT, `Application is already ${profile.approvalStatus}`);
  }
};

/** Applicant submits (or re-submits) the application for review. */
export const markSubmitted = (profile: IReviewable, userId: string) => {
  assertEditable(profile);
  const isResubmit = profile.approvalStatus !== ApprovalStatus.draft;
  profile.approvalStatus = ApprovalStatus.pending;
  profile.submittedAt = new Date();
  profile.applicationHistory.push({
    action: isResubmit ? "resubmitted" : "submitted",
    byUserId: new Types.ObjectId(userId),
    at: new Date(),
  });
};

/** Admin decision. Returns the new status. */
export const applyReview = (
  profile: IReviewable,
  action: ReviewAction,
  note: string | undefined,
  actorId: string,
) => {
  const transition = TRANSITIONS[action];
  if (!transition.from.includes(profile.approvalStatus)) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Cannot ${action.replace("_", " ")} an application that is ${profile.approvalStatus}`,
    );
  }

  profile.approvalStatus = transition.to;
  profile.reviewNote = note;
  profile.reviewedBy = new Types.ObjectId(actorId);
  profile.reviewedAt = new Date();
  profile.applicationHistory.push({
    action,
    note,
    byUserId: new Types.ObjectId(actorId),
    at: new Date(),
  });
  return transition.to;
};

/**
 * The role exists on the user only while the profile is approved —
 * so checkAuth(UserRole.vendor) alone guarantees an active, approved vendor.
 */
export const syncRole = async (
  userId: Types.ObjectId | string,
  role: UserRole.vendor | UserRole.rider,
  status: ApprovalStatus,
) => {
  if (status === ApprovalStatus.approved) {
    await User.updateOne({ _id: userId }, { $addToSet: { roles: role } });
  } else {
    await User.updateOne({ _id: userId }, { $pull: { roles: role } });
    // Don't leave the app stuck in a mode the user lost
    await User.updateOne(
      { _id: userId, lastActiveMode: role as unknown as AppMode },
      { $set: { lastActiveMode: AppMode.customer } },
    );
  }
};

/** Real-time heads-up to the applicant (the stored/pushed notification is sent by the caller). */
export const notifyApplicant = (
  userId: Types.ObjectId | string,
  kind: "vendor" | "rider",
  status: ApprovalStatus,
  note?: string,
) => emitToUser(String(userId), "application:reviewed", { kind, status, note });

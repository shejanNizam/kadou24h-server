import { model, Schema } from "mongoose";
import { fileRefSchema } from "../../utils/commonSchemas";
import {
  ApplicationKind,
  ApplicationStatus,
  IJobApplication,
} from "./job.interface";

const cvSnapshotSchema = new Schema(
  {
    file: { type: fileRefSchema },
    profession: { type: String, trim: true },
    skills: { type: [String], default: [] },
    summary: { type: String, trim: true },
  },
  { _id: false },
);

const interviewSchema = new Schema(
  {
    at: { type: Date },
    location: { type: String, trim: true },
    mapUrl: { type: String, trim: true },
    note: { type: String, trim: true },
    confirmedAt: { type: Date },
  },
  { _id: false },
);

const jobApplicationSchema = new Schema<IJobApplication>(
  {
    kind: {
      type: String,
      enum: Object.values(ApplicationKind),
      default: ApplicationKind.offer,
      required: true,
    },
    jobId: { type: Schema.Types.ObjectId, ref: "Job" },
    targetVendorId: { type: Schema.Types.ObjectId, ref: "VendorProfile" },
    applicantId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    cvSnapshot: { type: cvSnapshotSchema, required: true },
    matchScore: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: Object.values(ApplicationStatus),
      default: ApplicationStatus.applied,
      required: true,
    },
    interview: { type: interviewSchema },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

jobApplicationSchema.index(
  { jobId: 1, applicantId: 1 },
  {
    unique: true,
    partialFilterExpression: { jobId: { $exists: true } },
  },
);
jobApplicationSchema.index({ applicantId: 1, createdAt: -1 });
jobApplicationSchema.index({ targetVendorId: 1, status: 1 });

export const JobApplication = model<IJobApplication>(
  "JobApplication",
  jobApplicationSchema,
);

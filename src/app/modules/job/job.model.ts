import { model, Schema } from "mongoose";
import { fileRefSchema, geoPointSchema } from "../../utils/commonSchemas";
import {
  IJob,
  JobStatus,
  JobType,
  SalaryFrequency,
  WorkplaceType,
} from "./job.interface";

const jobSchema = new Schema<IJob>(
  {
    postedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    postedByMode: {
      type: String,
      enum: ["customer", "vendor", "rider"],
      default: "customer",
      required: true,
    },
    organizationName: { type: String, required: true, trim: true },
    organizationLogo: { type: fileRefSchema },
    isVerifiedOrg: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    jobType: {
      type: String,
      enum: Object.values(JobType),
      default: JobType.full_time,
      required: true,
    },
    workplace: {
      type: String,
      enum: Object.values(WorkplaceType),
      default: WorkplaceType.on_site,
      required: true,
    },
    country: { type: String, trim: true, default: "Guinea" },
    city: { type: String, trim: true, default: "Conakry" },
    area: { type: String, trim: true },
    location: { type: geoPointSchema },
    salaryCurrency: { type: String, trim: true, default: "GNF" },
    salaryMin: { type: Number, min: 0 },
    salaryMax: { type: Number, min: 0 },
    salaryFrequency: {
      type: String,
      enum: Object.values(SalaryFrequency),
      default: SalaryFrequency.monthly,
    },
    about: { type: String, required: true, trim: true },
    responsibilities: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    benefits: { type: [String], default: [] },
    aboutCompany: { type: String, trim: true },
    prefExperienceLevel: { type: String, trim: true },
    prefMinEducation: { type: String, trim: true },
    prefSkills: { type: [String], default: [] },
    prefLanguages: { type: [String], default: [] },
    applicationMethod: { type: String, trim: true, default: "in_app" },
    applicationDeadline: { type: Date },
    vacancies: { type: Number, default: 1, min: 1 },
    notificationEmail: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(JobStatus),
      default: JobStatus.draft,
      required: true,
    },
    publishPaymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    publishedAt: { type: Date },
    expiresAt: { type: Date },
    stats: {
      views: { type: Number, default: 0 },
      applicants: { type: Number, default: 0 },
      shortlisted: { type: Number, default: 0 },
      interviews: { type: Number, default: 0 },
    },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

jobSchema.index({ status: 1, expiresAt: 1 });
jobSchema.index({ postedBy: 1, status: 1 });
jobSchema.index({ categoryId: 1 });
jobSchema.index({ location: "2dsphere" });
jobSchema.index(
  { title: "text", organizationName: "text", about: "text" },
  { weights: { title: 10, organizationName: 5, about: 1 } },
);

export const Job = model<IJob>("Job", jobSchema);

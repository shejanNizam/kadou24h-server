import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

export enum JobType {
  full_time = "full_time",
  part_time = "part_time",
  contract = "contract",
  internship = "internship",
}

export enum WorkplaceType {
  on_site = "on_site",
  remote = "remote",
  hybrid = "hybrid",
}

export enum SalaryFrequency {
  monthly = "monthly",
  weekly = "weekly",
  hourly = "hourly",
}

export enum JobStatus {
  draft = "draft",
  pending_payment = "pending_payment",
  published = "published",
  closed = "closed",
  expired = "expired",
  // Taken down by the Kadou24h team (rules, fraud): hidden everywhere; only the team can bring it back
  removed = "removed",
}

export interface IJobStats {
  views: number;
  applicants: number;
  shortlisted: number;
  interviews: number;
}

/** Why and by whom the team took a job down; `previousStatus` comes back on restore */
export interface IJobRemoval {
  at: Date;
  by: Types.ObjectId;
  reason: string;
  previousStatus: JobStatus;
}

export interface IJobInitial {
  postedBy: Types.ObjectId;
  postedByMode: string;
  organizationName: string;
  organizationLogo?: IFileRef;
  isVerifiedOrg: boolean;
  title: string;
  categoryId?: Types.ObjectId;
  jobType: JobType;
  workplace: WorkplaceType;
  country?: string;
  city?: string;
  area?: string;
  location?: IGeoPoint;
  salaryCurrency: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryFrequency?: SalaryFrequency;
  about: string;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  aboutCompany?: string;
  prefExperienceLevel?: string;
  prefMinEducation?: string;
  prefSkills: string[];
  prefLanguages: string[];
  applicationMethod?: string;
  applicationDeadline?: Date;
  vacancies?: number;
  notificationEmail?: string;
  status: JobStatus;
  publishPaymentId?: Types.ObjectId;
  publishedAt?: Date;
  expiresAt?: Date;
  removal?: IJobRemoval;
  stats: IJobStats;
  isDeleted: boolean;
}

export type IJob = IJobInitial & Document;

export enum ApplicationKind {
  offer = "offer",
  spontaneous = "spontaneous",
}

export enum ApplicationStatus {
  pending_payment = "pending_payment", // paid spontaneous application, not yet paid — hidden from the vendor
  applied = "applied",
  under_review = "under_review",
  shortlisted = "shortlisted",
  interview = "interview",
  hired = "hired",
  rejected = "rejected",
  withdrawn = "withdrawn",
}

export interface ICvSnapshot {
  file?: IFileRef;
  profession?: string;
  skills?: string[];
  summary?: string;
}

export interface IInterview {
  at?: Date;
  location?: string;
  mapUrl?: string;
  note?: string;
  confirmedAt?: Date;
}

export interface IJobApplicationInitial {
  kind: ApplicationKind;
  jobId?: Types.ObjectId;
  targetVendorId?: Types.ObjectId;
  applicantId: Types.ObjectId;
  cvSnapshot: ICvSnapshot;
  matchScore: number;
  status: ApplicationStatus;
  interview?: IInterview;
  paymentId?: Types.ObjectId;
  conversationId?: Types.ObjectId;
}

export type IJobApplication = IJobApplicationInitial & Document;

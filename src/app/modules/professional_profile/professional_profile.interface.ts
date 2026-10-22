import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";
import { IBookingPenalty } from "../booking/booking.interface";
import { IReviewable } from "../profile_common/profile.common";

/** When the worker is available: days 0 (Sunday) … 6 (Saturday), hours "HH:mm". */
export interface IWorkingHours {
  days: number[];
  from: string;
  to: string;
}

export interface IProfileEducation {
  _id?: Types.ObjectId;
  degree: string;
  institution: string;
  year: string;
}

export interface IProfileExperience {
  _id?: Types.ObjectId;
  title: string;
  company?: string;
  location?: string;
  startDate?: Date;
  endDate?: Date;
  isCurrent: boolean;
  description?: string;
}

export interface IProfessionalProfileInitial {
  userId: Types.ObjectId;
  profession?: string;
  summary?: string;
  photo?: IFileRef;
  city?: string;
  location?: IGeoPoint;
  uploadedResume?: IFileRef;
  generatedCv?: IFileRef;
  generatedAt?: Date;
  skills: string[];
  languages: string[];
  achievements: string[];
  profileEducation: IProfileEducation[];
  profileExperience: IProfileExperience[];
  isWorkerListed: boolean;
  hourlyRate?: number;
  experienceYears?: number;
  serviceCategoryId?: Types.ObjectId;
  cvVisible: boolean;
  visibleUntil?: Date;
  ratingAvg: number;
  ratingCount: number;
  workingHours?: IWorkingHours;
  /** ID card / passport photo: seen only by the worker and the admins */
  idDocument?: IFileRef;
  /** Photos of past work, shown on the public worker page (max 10) */
  workPhotos: IFileRef[];
  /**
   * Customers see the worker only until this date: free trial after the first approval,
   * then a service-provider subscription (client, 2026-10-22).
   */
  listedUntil?: Date;
  trialUsedAt?: Date;
  /** Reminder / end notices already sent for this listedUntil */
  listingNotice?: { soonFor?: Date; endedFor?: Date };
  /** Cancellation penalties (see booking.constants PENALTY) */
  bookingPenalty?: IBookingPenalty;
}

/**
 * The approval fields (approvalStatus, reviewNote, submittedAt, applicationHistory…) are
 * about the WORKER listing: customers see a worker only once an admin approved it.
 */
export type IProfessionalProfile = IProfessionalProfileInitial &
  Omit<IReviewable, "_id" | "userId"> &
  Document;

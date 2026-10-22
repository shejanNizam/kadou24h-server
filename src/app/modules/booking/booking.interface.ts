import { Document, Types } from "mongoose";
import { IFileRef } from "../../interfaces/common.types";
import { IAddressSnapshot } from "../order/order.interface";

/**
 * Worker bookings (client rules, 2026-10-22): the customer sends a request (date,
 * address, description), the worker accepts or declines. Payment is made directly
 * between them (cash / Orange Money), never through the app, and there is no commission.
 *
 * requested → accepted → done (worker) → completed (customer confirms, or automatic)
 *           ↘ declined / expired / cancelled
 */
export enum BookingStatus {
  requested = "requested",
  accepted = "accepted",
  declined = "declined",
  expired = "expired",
  cancelled = "cancelled",
  /** The worker says the job is done; waiting for the customer to confirm */
  done = "done",
  completed = "completed",
}

export const OPEN_STATUSES = [BookingStatus.requested, BookingStatus.accepted, BookingStatus.done];
/** Contact details (phone, full address) are shared only in these statuses */
export const CONTACT_STATUSES = [BookingStatus.accepted, BookingStatus.done, BookingStatus.completed];

export type BookingActor = "customer" | "worker" | "admin" | "system";

export interface IBookingHistory {
  status: BookingStatus;
  by: BookingActor;
  at: Date;
  note?: string;
}

export interface IBookingInitial {
  bookingNumber: string;
  customerId: Types.ObjectId;
  /** The worker's user */
  workerId: Types.ObjectId;
  workerProfileId: Types.ObjectId;
  /** Snapshot of the worker when booked */
  profession?: string;
  hourlyRate?: number;
  serviceCategoryId?: Types.ObjectId;

  scheduledAt: Date;
  address: IAddressSnapshot;
  description: string;
  photos: IFileRef[];

  status: BookingStatus;
  respondBy: Date;
  acceptedAt?: Date;
  declinedAt?: Date;
  declineReason?: string;
  expiredAt?: Date;
  cancelledAt?: Date;
  cancelledBy?: BookingActor;
  cancelReason?: string;
  /** A cancellation after acceptance counts toward the penalties */
  cancelCounted?: boolean;
  doneAt?: Date;
  /** Entered by the worker when finishing: the price agreed with the customer (for "estimated earnings") */
  agreedPrice?: number;
  confirmBy?: Date;
  completedAt?: Date;
  completedBy?: BookingActor;
  reviewId?: Types.ObjectId;
  history: IBookingHistory[];
}

export type IBooking = IBookingInitial & Document & { createdAt: Date; updatedAt: Date };

// ── Penalties ───────────────────────────────────────────────────────

export enum StrikeRole {
  worker = "worker",
  customer = "customer",
}

export enum PenaltyType {
  warning = "warning",
  less_visible = "less_visible",
  suspension = "suspension",
  limited = "limited",
}

export interface IBookingStrikeInitial {
  userId: Types.ObjectId;
  role: StrikeRole;
  bookingId: Types.ObjectId;
  /** 1st, 2nd, 3rd+ cancellation within the rolling 30 days */
  tier: number;
  penalty: PenaltyType;
  lessVisibleUntil?: Date;
  suspendedUntil?: Date;
  limitedUntil?: Date;
  liftedAt?: Date;
  liftedBy?: Types.ObjectId;
  adminNote?: string;
  /** "soften": the admin replaced the suspension with 30 days of reduced visibility */
  softenedAt?: Date;
}

export type IBookingStrike = IBookingStrikeInitial & Document & { createdAt: Date };

/** Worker penalties, kept on the profile so the public search can use them */
export interface IBookingPenalty {
  lessVisibleUntil?: Date;
  suspendedUntil?: Date;
  limitedUntil?: Date;
}

// ── Reviews ─────────────────────────────────────────────────────────

export enum WorkerReviewStatus {
  visible = "visible",
  hidden = "hidden",
}

export interface IWorkerReviewInitial {
  bookingId: Types.ObjectId;
  workerProfileId: Types.ObjectId;
  workerId: Types.ObjectId;
  authorId: Types.ObjectId;
  rating: number;
  comment?: string;
  /** Photos of the completed work */
  photos: IFileRef[];
  status: WorkerReviewStatus;
}

export type IWorkerReview = IWorkerReviewInitial & Document & { createdAt: Date };

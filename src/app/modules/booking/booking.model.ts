import { model, Schema } from "mongoose";
import { fileRefSchema } from "../../utils/commonSchemas";
import { addressSnapshotSchema } from "../order/order.model";
import {
  BookingStatus,
  IBooking,
  IBookingStrike,
  IWorkerReview,
  PenaltyType,
  StrikeRole,
  WorkerReviewStatus,
} from "./booking.interface";

const ACTORS = ["customer", "worker", "admin", "system"];

const bookingSchema = new Schema<IBooking>(
  {
    bookingNumber: { type: String, required: true, unique: true, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workerProfileId: { type: Schema.Types.ObjectId, ref: "ProfessionalProfile", required: true },
    profession: { type: String, trim: true },
    hourlyRate: { type: Number, min: 0 },
    serviceCategoryId: { type: Schema.Types.ObjectId, ref: "Category" },

    scheduledAt: { type: Date, required: true },
    address: { type: addressSnapshotSchema, required: true },
    description: { type: String, required: true, trim: true },
    photos: { type: [fileRefSchema], default: [] },

    status: { type: String, enum: Object.values(BookingStatus), default: BookingStatus.requested, required: true },
    respondBy: { type: Date, required: true },
    acceptedAt: { type: Date },
    declinedAt: { type: Date },
    declineReason: { type: String, trim: true },
    expiredAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: String, enum: ACTORS },
    cancelReason: { type: String, trim: true },
    cancelCounted: { type: Boolean },
    doneAt: { type: Date },
    agreedPrice: { type: Number, min: 0 },
    confirmBy: { type: Date },
    completedAt: { type: Date },
    completedBy: { type: String, enum: ACTORS },
    reviewId: { type: Schema.Types.ObjectId, ref: "WorkerReview" },
    history: {
      type: [
        new Schema(
          {
            status: { type: String, enum: Object.values(BookingStatus), required: true },
            by: { type: String, enum: ACTORS, required: true },
            at: { type: Date, required: true },
            note: { type: String, trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, versionKey: false },
);

bookingSchema.index({ workerId: 1, status: 1, scheduledAt: 1 });
bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ customerId: 1, workerProfileId: 1, status: 1 });
// Sweeps: unanswered requests, jobs waiting for confirmation
bookingSchema.index({ status: 1, respondBy: 1 });
bookingSchema.index({ status: 1, confirmBy: 1 });
bookingSchema.index({ createdAt: -1 });

export const Booking = model<IBooking>("Booking", bookingSchema);

const bookingStrikeSchema = new Schema<IBookingStrike>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: Object.values(StrikeRole), required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    tier: { type: Number, required: true, min: 1 },
    penalty: { type: String, enum: Object.values(PenaltyType), required: true },
    lessVisibleUntil: { type: Date },
    suspendedUntil: { type: Date },
    limitedUntil: { type: Date },
    liftedAt: { type: Date },
    liftedBy: { type: Schema.Types.ObjectId, ref: "User" },
    adminNote: { type: String, trim: true },
    softenedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

bookingStrikeSchema.index({ userId: 1, role: 1, createdAt: -1 });
// One strike per booking and person
bookingStrikeSchema.index({ bookingId: 1, userId: 1 }, { unique: true });
bookingStrikeSchema.index({ createdAt: -1 });

export const BookingStrike = model<IBookingStrike>("BookingStrike", bookingStrikeSchema);

const workerReviewSchema = new Schema<IWorkerReview>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
    workerProfileId: { type: Schema.Types.ObjectId, ref: "ProfessionalProfile", required: true },
    workerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true },
    photos: { type: [fileRefSchema], default: [] },
    status: { type: String, enum: Object.values(WorkerReviewStatus), default: WorkerReviewStatus.visible, required: true },
  },
  { timestamps: true, versionKey: false },
);

workerReviewSchema.index({ workerProfileId: 1, status: 1, createdAt: -1 });
workerReviewSchema.index({ createdAt: -1 });

export const WorkerReview = model<IWorkerReview>("WorkerReview", workerReviewSchema);

/**
 * Worker reviews (client, 2026-10-22): 5 stars, a comment and photos of the completed
 * work. Only the customer of a completed booking, once — so every review is a real job.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { deleteFromCloudinary } from "../../config/cloudinary.config";
import { IFileRef } from "../../interfaces/common.types";
import { logger } from "../../utils/logger";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { BookingStatus, WorkerReviewStatus } from "./booking.interface";
import { Booking, WorkerReview } from "./booking.model";
import { BookingNotify } from "./booking.notify";

const recomputeWorkerRating = async (workerProfileId: Types.ObjectId) => {
  const [agg] = await WorkerReview.aggregate<{ avg: number; count: number }>([
    { $match: { workerProfileId, status: WorkerReviewStatus.visible } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  await ProfessionalProfile.updateOne(
    { _id: workerProfileId },
    { $set: { ratingAvg: agg ? Math.round(agg.avg * 10) / 10 : 0, ratingCount: agg?.count ?? 0 } },
  );
};

const createReview = async (customerId: string, bookingId: string, payload: { rating: number; comment?: string; photos?: IFileRef[] }) => {
  const booking = Types.ObjectId.isValid(bookingId) ? await Booking.findById(bookingId) : null;
  if (!booking || String(booking.customerId) !== customerId) throw new AppError(httpStatus.NOT_FOUND, "BOOKING_NOT_FOUND");
  if (booking.status !== BookingStatus.completed) {
    throw new AppError(httpStatus.BAD_REQUEST, "BOOKING_REVIEW_TOO_EARLY");
  }
  if (booking.reviewId) throw new AppError(httpStatus.CONFLICT, "BOOKING_ALREADY_REVIEWED");

  let review;
  try {
    review = await WorkerReview.create({
      bookingId: booking._id,
      workerProfileId: booking.workerProfileId,
      workerId: booking.workerId,
      authorId: booking.customerId,
      rating: payload.rating,
      comment: payload.comment,
      photos: payload.photos ?? [],
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError(httpStatus.CONFLICT, "BOOKING_ALREADY_REVIEWED");
    throw error;
  }
  booking.reviewId = review._id as Types.ObjectId;
  await booking.save();
  await recomputeWorkerRating(booking.workerProfileId);
  BookingNotify.reviewed(booking, payload.rating);
  return review;
};

/** "Delete my review" (client, 2026-11-22): the customer who wrote it; photos go too, the rating is redone */
const deleteMyReview = async (customerId: string, bookingId: string) => {
  const booking = Types.ObjectId.isValid(bookingId) ? await Booking.findOne({ _id: bookingId, customerId }) : null;
  const review = booking?.reviewId ? await WorkerReview.findOneAndDelete({ _id: booking.reviewId, authorId: booking.customerId }) : null;
  if (!booking || !review) throw new AppError(httpStatus.NOT_FOUND, "REVIEW_NOT_FOUND");
  booking.set("reviewId", undefined);
  await booking.save();
  await recomputeWorkerRating(booking.workerProfileId);
  await Promise.all(
    (review.photos ?? []).map((p) => deleteFromCloudinary(p.url).catch((error) => logger.warn("Review photo not deleted", { error: error instanceof Error ? error.message : error }))),
  );
  return { deleted: true };
};

/** Public: a worker's visible reviews (author name + avatar only). */
const getWorkerReviews = async (workerProfileId: string, query: { page?: number; limit?: number }) => {
  if (!Types.ObjectId.isValid(workerProfileId)) throw new AppError(httpStatus.NOT_FOUND, "WORKER_NOT_FOUND");
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const filter = { workerProfileId: new Types.ObjectId(workerProfileId), status: WorkerReviewStatus.visible };
  const [data, total, breakdown] = await Promise.all([
    WorkerReview.find(filter)
      .select("rating comment photos createdAt authorId")
      .populate("authorId", "name avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WorkerReview.countDocuments(filter),
    WorkerReview.aggregate<{ _id: number; n: number }>([{ $match: filter }, { $group: { _id: "$rating", n: { $sum: 1 } } }]),
  ]);
  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), stars: Object.fromEntries(breakdown.map((b) => [b._id, b.n])) },
    data,
  };
};

// ── Admin moderation ────────────────────────────────────────────────

const getReviewsForAdmin = async (query: { status?: string; rating?: string; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const filter: Record<string, unknown> = {};
  const status = Object.values(WorkerReviewStatus).find((s) => s === query.status);
  if (status) filter.status = status;
  if (query.rating && Number(query.rating) >= 1) filter.rating = Number(query.rating);
  const [data, total] = await Promise.all([
    WorkerReview.find(filter)
      .populate("authorId", "name phone avatar")
      .populate("workerId", "name phone avatar")
      .populate("bookingId", "bookingNumber scheduledAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WorkerReview.countDocuments(filter),
  ]);
  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, data };
};

const setReviewStatus = async (id: string, status: WorkerReviewStatus, actorId: string) => {
  const review = Types.ObjectId.isValid(id) ? await WorkerReview.findById(id) : null;
  if (!review) throw new AppError(httpStatus.NOT_FOUND, "REVIEW_NOT_FOUND");
  const before = review.status;
  review.status = status;
  await review.save();
  await recomputeWorkerRating(review.workerProfileId);
  await AuditLogServices.record({ actorId, action: `worker_review.${status}`, targetType: "worker_review", targetId: id, before: { status: before }, after: { status } });
  return review;
};

export const WorkerReviewServices = {
  createReview,
  deleteMyReview,
  getWorkerReviews,
  getReviewsForAdmin,
  setReviewStatus,
};

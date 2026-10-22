/**
 * Worker reviews (client, 2026-10-22): 5 stars, a comment and photos of the completed
 * work. Only the customer of a completed booking, once — so every review is a real job.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { IFileRef } from "../../interfaces/common.types";
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
  if (!booking || String(booking.customerId) !== customerId) throw new AppError(httpStatus.NOT_FOUND, "Booking not found");
  if (booking.status !== BookingStatus.completed) {
    throw new AppError(httpStatus.BAD_REQUEST, "You can review a worker once the job is completed");
  }
  if (booking.reviewId) throw new AppError(httpStatus.CONFLICT, "You already reviewed this booking");

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
    if ((error as { code?: number }).code === 11000) throw new AppError(httpStatus.CONFLICT, "You already reviewed this booking");
    throw error;
  }
  booking.reviewId = review._id as Types.ObjectId;
  await booking.save();
  await recomputeWorkerRating(booking.workerProfileId);
  BookingNotify.reviewed(booking, payload.rating);
  return review;
};

/** Public: a worker's visible reviews (author name + avatar only). */
const getWorkerReviews = async (workerProfileId: string, query: { page?: number; limit?: number }) => {
  if (!Types.ObjectId.isValid(workerProfileId)) throw new AppError(httpStatus.NOT_FOUND, "Worker profile not found");
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
  if (!review) throw new AppError(httpStatus.NOT_FOUND, "Review not found");
  const before = review.status;
  review.status = status;
  await review.save();
  await recomputeWorkerRating(review.workerProfileId);
  await AuditLogServices.record({ actorId, action: `worker_review.${status}`, targetType: "worker_review", targetId: id, before: { status: before }, after: { status } });
  return review;
};

export const WorkerReviewServices = {
  createReview,
  getWorkerReviews,
  getReviewsForAdmin,
  setReviewStatus,
};

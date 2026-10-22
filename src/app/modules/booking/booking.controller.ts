import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { BookingPenalty } from "./booking.penalty";
import { WorkerReviewServices } from "./booking.review.service";
import { BookingServices } from "./booking.service";

const ok = (res: Response, message: string, data: unknown, statusCode: number = httpStatus.OK) =>
  sendResponse(res, { statusCode, success: true, message, data });

/** Paginated results keep their meta at the top level, like the other lists */
const page = (res: Response, message: string, result: { meta: unknown; data: unknown }) =>
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message, meta: result.meta as never, data: result.data });

const id = (req: Request) => String(req.params.id);

const createBooking = catchAsync(async (req, res) => ok(res, "Booking request sent", await BookingServices.createBooking(req.user._id, req.body), httpStatus.CREATED));
const getMyBookings = catchAsync(async (req, res) => page(res, "Bookings retrieved", await BookingServices.getMyBookings(req.user._id, req.query as never)));
const getMyStanding = catchAsync(async (req, res) => ok(res, "Booking standing retrieved", await BookingPenalty.getMyStanding(req.user._id)));
const getMyBooking = catchAsync(async (req, res) => ok(res, "Booking retrieved", await BookingServices.getMyBooking(req.user._id, id(req))));
const accept = catchAsync(async (req, res) => ok(res, "Booking accepted", await BookingServices.accept(req.user._id, id(req))));
const decline = catchAsync(async (req, res) => ok(res, "Booking declined", await BookingServices.decline(req.user._id, id(req), req.body.reason)));
const cancel = catchAsync(async (req, res) => ok(res, "Booking cancelled", await BookingServices.cancel(req.user._id, id(req), req.body.reason)));
const markDone = catchAsync(async (req, res) => ok(res, "Job marked as done", await BookingServices.markDone(req.user._id, id(req), req.body)));
const confirmDone = catchAsync(async (req, res) => ok(res, "Job confirmed", await BookingServices.confirmDone(req.user._id, id(req))));
const reportNotDone = catchAsync(async (req, res) => ok(res, "The worker was told the job is not finished", await BookingServices.reportNotDone(req.user._id, id(req), req.body.note)));
const getWorkerReviews = catchAsync(async (req, res) => page(res, "Reviews retrieved", await WorkerReviewServices.getWorkerReviews(id(req), req.query as never)));
const createReview = catchAsync(async (req, res) => ok(res, "Thank you for your review", await WorkerReviewServices.createReview(req.user._id, id(req), req.body), httpStatus.CREATED));

// Admin
const getBookingsForAdmin = catchAsync(async (req, res) => page(res, "Bookings retrieved", await BookingServices.getBookingsForAdmin(req.query as never)));
const getBookingForAdmin = catchAsync(async (req, res) => ok(res, "Booking retrieved", await BookingServices.getBookingForAdmin(id(req))));
const cancelByAdmin = catchAsync(async (req, res) => ok(res, "Booking cancelled", await BookingServices.cancelByAdmin(id(req), req.body.reason, req.user._id)));
const listStrikes = catchAsync(async (req, res) => page(res, "Penalties retrieved", await BookingPenalty.listStrikes(req.query as never)));
const changeStrike = catchAsync(async (req, res) => ok(res, "Penalty updated", await BookingPenalty.changeStrike(id(req), req.body, req.user._id)));
const getReviewsForAdmin = catchAsync(async (req, res) => page(res, "Reviews retrieved", await WorkerReviewServices.getReviewsForAdmin(req.query as never)));
const setReviewStatus = catchAsync(async (req, res) => ok(res, "Review updated", await WorkerReviewServices.setReviewStatus(id(req), req.body.status, req.user._id)));

export const BookingControllers = {
  createBooking,
  getMyBookings,
  getMyStanding,
  getMyBooking,
  accept,
  decline,
  cancel,
  markDone,
  confirmDone,
  reportNotDone,
  createReview,
  getWorkerReviews,
  getBookingsForAdmin,
  getBookingForAdmin,
  cancelByAdmin,
  listStrikes,
  changeStrike,
  getReviewsForAdmin,
  setReviewStatus,
};

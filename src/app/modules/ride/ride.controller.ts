import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ADMIN_ROLES } from "../user/user.interface";
import { RideServices } from "./ride.service";

const ok = (res: Response, message: string, data: unknown, statusCode: number = httpStatus.OK) =>
  sendResponse(res, { statusCode, success: true, message, data });

/** Paginated results keep their meta at the top level, like the other lists */
const page = (res: Response, message: string, result: { meta: unknown; data: unknown }) =>
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message, meta: result.meta as never, data: result.data });

const id = (req: Request) => String(req.params.id);
const isStaff = (req: Request) => (req.user.roles ?? []).some((r: string) => (ADMIN_ROLES as string[]).includes(r));

// Passenger
const estimate = catchAsync(async (req, res) => ok(res, "Ride price", await RideServices.estimate(req.user._id, req.body)));
const requestRide = catchAsync(async (req, res) => ok(res, "Looking for a rider", await RideServices.requestRide(req.user._id, req.body), httpStatus.CREATED));
const getMyRides = catchAsync(async (req, res) => page(res, "Rides retrieved", await RideServices.getMyRides(req.user._id, req.query as never)));
const getMyCurrentRide = catchAsync(async (req, res) => ok(res, "Current ride", await RideServices.getMyCurrentRide(req.user._id)));
const getRide = catchAsync(async (req, res) => ok(res, "Ride retrieved", await RideServices.getRide(req.user._id, id(req), isStaff(req))));
const cancelRide = catchAsync(async (req, res) => ok(res, "Ride cancelled", await RideServices.cancelByPassenger(req.user._id, id(req), req.body.reason)));
const rateRide = catchAsync(async (req, res) => ok(res, "Thank you for your rating", await RideServices.rateRide(req.user._id, id(req), req.body)));

// Rider
const getRideOffers = catchAsync(async (req, res) => ok(res, "Rides near you", await RideServices.getRideOffers(req.user._id)));
const getRiderCurrentRide = catchAsync(async (req, res) => ok(res, "Current ride", await RideServices.getRiderCurrentRide(req.user._id)));
const getRiderRides = catchAsync(async (req, res) => page(res, "Rides retrieved", await RideServices.getRiderRides(req.user._id, req.query as never)));
const acceptRide = catchAsync(async (req, res) => ok(res, "Ride accepted: go to the pickup point", await RideServices.acceptRide(req.user._id, id(req))));
const skipRide = catchAsync(async (req, res) => ok(res, "Ride hidden", await RideServices.skipRide(req.user._id, id(req))));
const arrived = catchAsync(async (req, res) => ok(res, "The passenger is told you are here", await RideServices.riderStep(req.user._id, id(req), "arrived")));
const startRide = catchAsync(async (req, res) => ok(res, "Ride started", await RideServices.riderStep(req.user._id, id(req), "start")));
const completeRide = catchAsync(async (req, res) => ok(res, "Ride finished: collect the fare in cash", await RideServices.riderStep(req.user._id, id(req), "complete")));
const releaseRide = catchAsync(async (req, res) => ok(res, "Ride dropped: it goes back to the other riders", await RideServices.releaseByRider(req.user._id, id(req), req.body.reason)));

// Admin
const getRidesForAdmin = catchAsync(async (req, res) => page(res, "Rides retrieved", await RideServices.getRidesForAdmin(req.query as never)));
const getRideForAdmin = catchAsync(async (req, res) => ok(res, "Ride retrieved", await RideServices.getRide(req.user._id, id(req), true)));
const cancelByAdmin = catchAsync(async (req, res) => ok(res, "Ride cancelled", await RideServices.cancelByAdmin(req.user._id, id(req), req.body.reason)));

export const RideControllers = {
  estimate,
  requestRide,
  getMyRides,
  getMyCurrentRide,
  getRide,
  cancelRide,
  rateRide,
  getRideOffers,
  getRiderCurrentRide,
  getRiderRides,
  acceptRide,
  skipRide,
  arrived,
  startRide,
  completeRide,
  releaseRide,
  getRidesForAdmin,
  getRideForAdmin,
  cancelByAdmin,
};

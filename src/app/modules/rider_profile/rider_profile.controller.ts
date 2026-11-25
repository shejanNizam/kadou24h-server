import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { RiderProfileServices } from "./rider_profile.service";

// ── Applicant / rider ──

const getMyRiderProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.getMyRiderProfile(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery partner profile retrieved successfully!",
    data: result,
  });
});

const saveApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.saveApplication(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application saved",
    data: result,
  });
});

const submitApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.submitApplication(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application submitted. We will review it shortly.",
    data: result,
  });
});

const deleteDraftApplication = catchAsync(async (req: Request, res: Response) => {
  await RiderProfileServices.deleteDraftApplication(req.user._id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Draft application deleted", data: null });
});

const updateMyRiderProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.updateMyRiderProfile(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery partner profile updated!",
    data: result,
  });
});

// ── Vendor ──

const searchRiders = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.searchRiders(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery partners retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

// ── Admin ──

const getRidersForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.getRidersForAdmin(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery partners retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getRiderForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.getRiderForAdmin(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery partner retrieved successfully!",
    data: result,
  });
});

const reviewDocument = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.reviewDocument(
    req.params.id as string,
    req.params.docId as string,
    req.body,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Document reviewed",
    data: result,
  });
});

const reviewApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await RiderProfileServices.reviewApplication(
    req.params.id as string,
    req.body,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Delivery partner ${result.approvalStatus}`,
    data: result,
  });
});

export const RiderProfileControllers = {
  getMyRiderProfile,
  saveApplication,
  submitApplication,
  deleteDraftApplication,
  updateMyRiderProfile,
  searchRiders,
  getRidersForAdmin,
  getRiderForAdmin,
  reviewDocument,
  reviewApplication,
};

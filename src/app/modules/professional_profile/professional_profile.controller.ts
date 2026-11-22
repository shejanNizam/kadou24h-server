import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ProfessionalProfileServices } from "./professional_profile.service";

/** "Delete my CV" (the CV text and both files; a worker keeps their worker page) */
const deleteMyCv = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.deleteMyCv(req.user._id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "CV deleted", data: result });
});

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.getMyProfile(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile retrieved successfully!",
    data: result,
  });
});

const upsertProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.upsertProfile(
    req.user._id,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile updated successfully!",
    data: result,
  });
});

const toggleWorkerListing = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.toggleWorkerListing(
    req.user._id,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Worker listing updated successfully!",
    data: result,
  });
});

const generateAiCv = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.generateAiCv(
    req.user._id,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "CV summary suggested",
    data: result,
  });
});

const searchWorkers = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.searchWorkers({
    search: req.query.search as string,
    categoryId: req.query.categoryId as string,
    city: req.query.city as string,
    lat: req.query.lat ? Number(req.query.lat) : undefined,
    lng: req.query.lng ? Number(req.query.lng) : undefined,
    maxDistanceKm: req.query.maxDistanceKm ? Number(req.query.maxDistanceKm) : undefined,
    minRating: req.query.minRating ? Number(req.query.minRating) : undefined,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Workers retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getWorkerById = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.getWorkerById(
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Worker profile retrieved successfully!",
    data: result,
  });
});

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message, data });

const submitWorkerApplication = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Worker profile sent for review", await ProfessionalProfileServices.submitWorkerApplication(req.user._id));
});

const getWorkerSummary = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Worker summary retrieved", await ProfessionalProfileServices.getWorkerSummary(req.user._id));
});

const getWorkersForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await ProfessionalProfileServices.getWorkersForAdmin(req.query as Record<string, string>);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Worker applications retrieved", meta: result.meta, data: result.data });
});

const getWorkerForAdmin = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Worker application retrieved", await ProfessionalProfileServices.getWorkerForAdmin(req.params.id as string));
});

const reviewWorker = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Worker application reviewed", await ProfessionalProfileServices.reviewWorker(req.params.id as string, req.body, req.user._id));
});

export const ProfessionalProfileControllers = {
  deleteMyCv,
  submitWorkerApplication,
  getWorkerSummary,
  getWorkersForAdmin,
  getWorkerForAdmin,
  reviewWorker,
  getMyProfile,
  upsertProfile,
  toggleWorkerListing,
  generateAiCv,
  searchWorkers,
  getWorkerById,
};

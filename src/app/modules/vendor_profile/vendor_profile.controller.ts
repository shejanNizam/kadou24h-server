import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { VendorProfileServices } from "./vendor_profile.service";

// ── Applicant / vendor ──

const getMyVendorProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.getMyVendorProfile(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Vendor profile retrieved successfully!",
    data: result,
  });
});

const saveApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.saveApplication(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application saved",
    data: result,
  });
});

const submitApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.submitApplication(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application submitted. We will review it shortly.",
    data: result,
  });
});

const updateMyStore = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.updateMyStore(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store updated successfully!",
    data: result,
  });
});

const updateAvailability = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.updateAvailability(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store availability updated!",
    data: result,
  });
});

// ── Public ──

const getPublicVendors = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.getPublicVendors(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stores retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getPublicVendor = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.getPublicVendor(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store retrieved successfully!",
    data: result,
  });
});

// ── Admin ──

const getVendorsForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.getVendorsForAdmin(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Vendors retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getVendorForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.getVendorForAdmin(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Vendor retrieved successfully!",
    data: result,
  });
});

const reviewDocument = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorProfileServices.reviewDocument(
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
  const result = await VendorProfileServices.reviewApplication(
    req.params.id as string,
    req.body,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Vendor ${result.approvalStatus}`,
    data: result,
  });
});

export const VendorProfileControllers = {
  getMyVendorProfile,
  saveApplication,
  submitApplication,
  updateMyStore,
  updateAvailability,
  getPublicVendors,
  getPublicVendor,
  getVendorsForAdmin,
  getVendorForAdmin,
  reviewDocument,
  reviewApplication,
};

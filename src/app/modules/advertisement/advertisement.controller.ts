import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AdvertisementServices } from "./advertisement.service";

const getActiveAds = catchAsync(async (req: Request, res: Response) => {
  const placement = req.query.placement as string | undefined;
  const result = await AdvertisementServices.getActiveAds(placement);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Active advertisements retrieved successfully",
    data: result,
  });
});

const recordImpression = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await AdvertisementServices.recordImpression(id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ad impression recorded",
    data: result,
  });
});

const recordClick = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await AdvertisementServices.recordClick(id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ad click recorded",
    data: result,
  });
});

const createAdAdmin = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user._id;
  const result = await AdvertisementServices.createAdAdmin(adminId, req.body);

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Advertisement created successfully",
    data: result,
  });
});

const getAllAdsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await AdvertisementServices.getAllAdsAdmin(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin advertisements retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getAdByIdAdmin = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await AdvertisementServices.getAdByIdAdmin(id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Advertisement details retrieved successfully",
    data: result,
  });
});

const updateAdAdmin = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user._id;
  const id = req.params.id as string;
  const result = await AdvertisementServices.updateAdAdmin(adminId, id, req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Advertisement updated successfully",
    data: result,
  });
});

const deleteAdAdmin = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user._id;
  const id = req.params.id as string;
  const result = await AdvertisementServices.deleteAdAdmin(adminId, id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Advertisement deleted successfully",
    data: result,
  });
});

export const AdvertisementControllers = {
  getActiveAds,
  recordImpression,
  recordClick,
  createAdAdmin,
  getAllAdsAdmin,
  getAdByIdAdmin,
  updateAdAdmin,
  deleteAdAdmin,
};

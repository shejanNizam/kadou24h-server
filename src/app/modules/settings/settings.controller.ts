import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { SettingsServices } from "./settings.service";

const getPublicSettings = catchAsync(async (_req: Request, res: Response) => {
  const result = await SettingsServices.getPublicSettings();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Settings retrieved successfully!",
    data: result,
  });
});

const getSettings = catchAsync(async (_req: Request, res: Response) => {
  const result = await SettingsServices.getSettings();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Settings retrieved successfully!",
    data: result,
  });
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const result = await SettingsServices.updateSettings(req.body, req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Settings updated successfully!",
    data: result,
  });
});

export const SettingsControllers = {
  getPublicSettings,
  getSettings,
  updateSettings,
};

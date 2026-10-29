import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AppErrorServices } from "./app_error.service";

const report = catchAsync(async (req: Request, res: Response) => {
  await AppErrorServices.report(req.body, (req.user as JwtPayload | undefined)?._id);
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: "Error reported", data: null });
});

const list = catchAsync(async (req: Request, res: Response) => {
  const result = await AppErrorServices.list(req.query as Record<string, string>);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "App errors retrieved", meta: result.meta, data: result.data });
});

export const AppErrorControllers = { report, list };

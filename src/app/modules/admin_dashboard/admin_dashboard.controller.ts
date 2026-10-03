import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AdminDashboardServices } from "./admin_dashboard.service";

const getPlatformOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminDashboardServices.getPlatformOverview();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin dashboard overview retrieved successfully",
    data: result,
  });
});

export const AdminDashboardControllers = {
  getPlatformOverview,
};

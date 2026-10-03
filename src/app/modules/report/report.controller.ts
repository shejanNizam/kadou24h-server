import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ReportServices } from "./report.service";

const createReport = catchAsync(async (req: Request, res: Response) => {
  const reporterId = req.user._id;
  const result = await ReportServices.createReport(reporterId, req.body);

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Report submitted successfully",
    data: result,
  });
});

const getMyReports = catchAsync(async (req: Request, res: Response) => {
  const reporterId = req.user._id;
  const result = await ReportServices.getMyReports(reporterId, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "My reports retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getAllReportsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await ReportServices.getAllReportsAdmin(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin reports queue retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const actionReportAdmin = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user._id;
  const id = req.params.id as string;
  const result = await ReportServices.actionReportAdmin(adminId, id, req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Report actioned successfully",
    data: result,
  });
});

export const ReportControllers = {
  createReport,
  getMyReports,
  getAllReportsAdmin,
  actionReportAdmin,
};

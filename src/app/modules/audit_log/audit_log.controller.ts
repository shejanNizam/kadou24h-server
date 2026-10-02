import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AuditLogServices } from "./audit_log.service";

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const result = await AuditLogServices.getAuditLogs(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Audit logs retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

export const AuditLogControllers = {
  getAuditLogs,
};

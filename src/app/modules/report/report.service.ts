import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { IReport, ReportStatus, ReportTargetType } from "./report.interface";
import { Report } from "./report.model";

const createReport = async (
  reporterId: string,
  payload: {
    targetType: ReportTargetType;
    targetId: string;
    orderId?: string;
    conversationId?: string;
    reason: string;
    description?: string;
  },
): Promise<IReport> => {
  const report = await Report.create({
    reporterId: new Types.ObjectId(reporterId),
    targetType: payload.targetType,
    targetId: new Types.ObjectId(payload.targetId),
    orderId: payload.orderId ? new Types.ObjectId(payload.orderId) : undefined,
    conversationId: payload.conversationId
      ? new Types.ObjectId(payload.conversationId)
      : undefined,
    reason: payload.reason,
    description: payload.description,
    status: ReportStatus.pending,
  });

  return report;
};

const getMyReports = async (
  reporterId: string,
  query: { page?: number; limit?: number; status?: string },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    reporterId: new Types.ObjectId(reporterId),
  };
  if (query.status) {
    filter.status = query.status;
  }

  const [data, total] = await Promise.all([
    Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Report.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const getAllReportsAdmin = async (query: {
  targetType?: string;
  status?: string;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.targetType) filter.targetType = query.targetType;
  if (query.status) filter.status = query.status;

  const [data, total] = await Promise.all([
    Report.find(filter)
      .populate("reporterId", "name phone email avatar")
      .populate("handledBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Report.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const actionReportAdmin = async (
  adminId: string,
  reportId: string,
  payload: {
    status: ReportStatus;
    actionTaken?: string;
    adminNotes?: string;
  },
): Promise<IReport> => {
  const report = await Report.findById(reportId);
  if (!report) {
    throw new AppError(404, "REPORT_NOT_FOUND");
  }

  report.status = payload.status;
  if (payload.actionTaken) report.actionTaken = payload.actionTaken;
  if (payload.adminNotes) report.adminNotes = payload.adminNotes;
  report.handledBy = new Types.ObjectId(adminId);

  await report.save();
  return report;
};

export const ReportServices = {
  createReport,
  getMyReports,
  getAllReportsAdmin,
  actionReportAdmin,
};

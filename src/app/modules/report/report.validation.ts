import { z } from "zod";
import { ReportStatus, ReportTargetType } from "./report.interface";

const createReportZodSchema = z.object({
  body: z.object({
    targetType: z.nativeEnum(ReportTargetType),
    targetId: z.string().min(1, "FIELD_REQUIRED"),
    orderId: z.string().optional(),
    conversationId: z.string().optional(),
    reason: z.string().min(2, "REASON_TOO_SHORT"),
    description: z.string().optional(),
  }),
});

const actionReportZodSchema = z.object({
  body: z.object({
    status: z.nativeEnum(ReportStatus),
    actionTaken: z.string().optional(),
    adminNotes: z.string().optional(),
  }),
});

export const ReportValidations = {
  createReportZodSchema,
  actionReportZodSchema,
};

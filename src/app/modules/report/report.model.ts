import { model, Schema } from "mongoose";
import { IReport, ReportStatus, ReportTargetType } from "./report.interface";

export const reportSchema = new Schema<IReport>(
  {
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: Object.values(ReportTargetType),
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "orders",
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(ReportStatus),
      default: ReportStatus.pending,
      required: true,
    },
    handledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    actionTaken: {
      type: String,
      trim: true,
    },
    adminNotes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

reportSchema.index({ targetType: 1, status: 1 });
reportSchema.index({ createdAt: -1 });

export const Report = model<IReport>("Report", reportSchema);

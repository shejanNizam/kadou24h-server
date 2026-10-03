import { Document, Types } from "mongoose";

export enum ReportTargetType {
  user = "user",
  review = "review",
  order = "order",
  message = "message",
}

export enum ReportStatus {
  pending = "pending",
  reviewed = "reviewed",
  actioned = "actioned",
  dismissed = "dismissed",
}

export interface IReportInitial {
  reporterId: Types.ObjectId;
  targetType: ReportTargetType;
  targetId: Types.ObjectId;
  orderId?: Types.ObjectId;
  conversationId?: Types.ObjectId;
  reason: string;
  description?: string;
  status: ReportStatus;
  handledBy?: Types.ObjectId;
  actionTaken?: string;
  adminNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IReport = IReportInitial & Document;

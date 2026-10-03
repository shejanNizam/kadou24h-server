import { Document, Types } from "mongoose";

export enum PaymentPurpose {
  order = "order",
  subscription = "subscription",
  job_publish = "job_publish",
  cv_unlock = "cv_unlock",
  spontaneous_application = "spontaneous_application",
}

export enum PaymentMethod {
  cod = "cod",
  orange_money = "orange_money",
  mobile_money = "mobile_money",
  card = "card",
}

export enum PaymentStatus {
  pending = "pending",
  success = "success",
  failed = "failed",
  refunded = "refunded",
}

export interface IPayment extends Document {
  _id: Types.ObjectId;
  payerId: Types.ObjectId;
  purpose: PaymentPurpose;
  refId: Types.ObjectId | string;
  contextId?: Types.ObjectId | string;
  method: PaymentMethod;
  provider?: string;
  amount: number;
  status: PaymentStatus;
  providerRef?: string;
  idempotencyKey?: string;
  paidAt?: Date;
  raw?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export enum RefundStatus {
  pending = "pending",
  completed = "completed",
  rejected = "rejected",
}

export interface IRefund extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  subOrderId?: Types.ObjectId;
  paymentId?: Types.ObjectId;
  customerId: Types.ObjectId;
  amount: number;
  reason: string;
  notes?: string;
  status: RefundStatus;
  issuedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export enum DisputeStatus {
  open = "open",
  resolved = "resolved",
  rejected = "rejected",
}

export interface IDispute extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  subOrderId?: Types.ObjectId;
  customerId: Types.ObjectId;
  amount?: number;
  reason: string;
  adminResolution?: string;
  status: DisputeStatus;
  notes?: string;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

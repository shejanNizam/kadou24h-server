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
  checkoutUrl?: string;
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

// Why money is owed back to the customer
export enum RefundSource {
  cancellation = "cancellation", // a store, the customer or an admin cancelled a paid order
  modification = "modification", // a store removed items from a paid order
  order_fees = "order_fees", // the whole order was cancelled: platform fee + tax
  dispute = "dispute", // an admin resolved a dispute with a refund
  admin = "admin", // an admin issued a refund by hand
}

export interface IRefundLine {
  subOrderId?: Types.ObjectId;
  source: RefundSource;
  reason: string;
  amount: number;
  at: Date;
}

/**
 * Money going back to a customer who paid online. Cancellations and changes
 * open (or add to) ONE pending request per order; an admin approves it after
 * sending the money (transfer reference) or rejects it with a reason.
 * Disputes and manual refunds are created already completed.
 */
export interface IRefund extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  subOrderId?: Types.ObjectId;
  paymentId?: Types.ObjectId;
  paymentMethod?: PaymentMethod;
  customerId: Types.ObjectId;
  amount: number;
  /** What the request asked for (an admin may approve less, e.g. keep a delivery fee) */
  requestedAmount?: number;
  source: RefundSource;
  reason: string;
  lines: IRefundLine[];
  notes?: string;
  status: RefundStatus;
  transactionId?: string;
  rejectionReason?: string;
  issuedBy?: Types.ObjectId;
  processedAt?: Date;
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

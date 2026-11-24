import { model, Schema } from "mongoose";
import { IRefund, IRefundLine, PaymentMethod, RefundSource, RefundStatus } from "./payment.interface";

const refundLineSchema = new Schema<IRefundLine>(
  {
    subOrderId: { type: Schema.Types.ObjectId, ref: "sub_orders" },
    source: { type: String, enum: Object.values(RefundSource), required: true },
    reason: { type: String, required: true, trim: true },
    by: { type: String },
    note: { type: String, trim: true },
    paidAfterCancel: { type: Boolean },
    amount: { type: Number, required: true, min: 1 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const refundSchema = new Schema<IRefund>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "orders", required: true },
    subOrderId: { type: Schema.Types.ObjectId, ref: "sub_orders" },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    paymentMethod: { type: String, enum: Object.values(PaymentMethod) },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },
    requestedAmount: { type: Number, min: 1 },
    source: { type: String, enum: Object.values(RefundSource), default: RefundSource.admin },
    reason: { type: String, required: true, trim: true },
    lines: { type: [refundLineSchema], default: [] },
    notes: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(RefundStatus),
      default: RefundStatus.pending,
      required: true,
    },
    transactionId: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User" },
    processedAt: { type: Date },
    dueBy: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

refundSchema.index({ status: 1, createdAt: -1 });
refundSchema.index({ orderId: 1 });
refundSchema.index({ status: 1, dueBy: 1 });
// At most one open request per order: new cancellations / changes add to it
refundSchema.index(
  { orderId: 1 },
  { unique: true, partialFilterExpression: { status: RefundStatus.pending }, name: "one_pending_refund_per_order" },
);

export const Refund = model<IRefund>("Refund", refundSchema);

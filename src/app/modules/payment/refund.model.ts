import { model, Schema } from "mongoose";
import { IRefund, RefundStatus } from "./payment.interface";

const refundSchema = new Schema<IRefund>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    subOrderId: { type: Schema.Types.ObjectId, ref: "SubOrder" },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(RefundStatus),
      default: RefundStatus.pending,
      required: true,
    },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

refundSchema.index({ status: 1, createdAt: -1 });
refundSchema.index({ orderId: 1 });

export const Refund = model<IRefund>("Refund", refundSchema);

import { model, Schema } from "mongoose";
import { DisputeStatus, DisputeType, IDispute } from "./payment.interface";

const disputeSchema = new Schema<IDispute>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "orders", required: true },
    subOrderId: { type: Schema.Types.ObjectId, ref: "sub_orders" },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, min: 0 },
    type: { type: String, enum: Object.values(DisputeType) },
    reason: { type: String, required: true, trim: true },
    adminResolution: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(DisputeStatus),
      default: DisputeStatus.open,
      required: true,
    },
    notes: { type: String, trim: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

disputeSchema.index({ status: 1, createdAt: -1 });
disputeSchema.index({ customerId: 1, createdAt: -1 });
// One open dispute per store part (or per whole order, no subOrderId) at a time
disputeSchema.index(
  { orderId: 1, subOrderId: 1 },
  { unique: true, partialFilterExpression: { status: DisputeStatus.open } },
);

export const Dispute = model<IDispute>("Dispute", disputeSchema);

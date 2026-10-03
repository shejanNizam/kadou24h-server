import { model, Schema } from "mongoose";
import {
  IPayment,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from "./payment.interface";

const paymentSchema = new Schema<IPayment>(
  {
    payerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: {
      type: String,
      enum: Object.values(PaymentPurpose),
      required: true,
    },
    refId: { type: Schema.Types.Mixed, required: true },
    contextId: { type: Schema.Types.Mixed },
    method: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: true,
    },
    provider: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.pending,
      required: true,
    },
    providerRef: { type: String, trim: true },
    idempotencyKey: { type: String, trim: true, sparse: true, unique: true },
    paidAt: { type: Date },
    raw: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

paymentSchema.index({ purpose: 1, refId: 1 });
paymentSchema.index({ payerId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ providerRef: 1 });
paymentSchema.index(
  { payerId: 1, purpose: 1, refId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      purpose: PaymentPurpose.cv_unlock,
      status: PaymentStatus.success,
    },
  },
);

export const Payment = model<IPayment>("Payment", paymentSchema);

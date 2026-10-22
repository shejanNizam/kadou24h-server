import { model, Schema } from "mongoose";
import { CouponType, ICoupon, ICouponRedemption, RedemptionStatus } from "./coupon.interface";

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    type: { type: String, enum: Object.values(CouponType), required: true },
    value: { type: Number, required: true, min: 1 },
    maxDiscount: { type: Number, min: 1 },
    minOrder: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date },
    expiresAt: { type: Date, required: true },
    usageLimit: { type: Number, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    discountGiven: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false },
);

couponSchema.index({ isActive: 1, expiresAt: 1 });

export const Coupon = model<ICoupon>("Coupon", couponSchema);

const couponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", required: true },
    code: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "orders", required: true },
    orderNumber: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: Object.values(RedemptionStatus), default: RedemptionStatus.active, required: true },
    releasedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

// One use per customer: at most one active redemption per code and customer
couponRedemptionSchema.index(
  { couponId: 1, customerId: 1 },
  { unique: true, partialFilterExpression: { status: RedemptionStatus.active } },
);
couponRedemptionSchema.index({ orderId: 1 });
couponRedemptionSchema.index({ couponId: 1, createdAt: -1 });

export const CouponRedemption = model<ICouponRedemption>("CouponRedemption", couponRedemptionSchema);

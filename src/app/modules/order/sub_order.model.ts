import { Schema, model } from "mongoose";
import {
  ISubOrder,
  ISubOrderItem,
  ISubOrderModification,
  ISubOrderTimelineEntry,
  SettlementStatus,
  SubOrderStatus,
} from "./order.interface";

const subOrderItemSchema = new Schema<ISubOrderItem>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    removed: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true },
);

const subOrderTimelineSchema = new Schema<ISubOrderTimelineEntry>(
  {
    status: {
      type: String,
      required: true,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
    },
    byUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    at: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { _id: true },
);

const subOrderModificationSchema = new Schema<ISubOrderModification>(
  {
    removedItems: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product" },
        name: { type: String },
        qty: { type: Number },
        unitPrice: { type: Number },
        lineTotal: { type: Number },
      },
    ],
    oldTotal: { type: Number, required: true },
    newTotal: { type: Number, required: true },
    refundAmount: { type: Number, default: 0 },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, default: Date.now, required: true },
  },
  { _id: true },
);

const subOrderSchema = new Schema<ISubOrder>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "orders",
      required: true,
      index: true,
    },
    subOrderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "VendorProfile",
      required: true,
      index: true,
    },
    currentLegId: {
      type: Schema.Types.ObjectId,
      ref: "deliveries",
    },
    currentRiderId: {
      type: Schema.Types.ObjectId,
      ref: "RiderProfile",
    },
    items: {
      type: [subOrderItemSchema],
      required: true,
    },
    timeline: {
      type: [subOrderTimelineSchema],
      default: [],
    },
    modifications: {
      type: [subOrderModificationSchema],
      default: [],
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryFee: {
      type: Number,
      required: true,
      min: 0,
    },
    discountShare: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    vendorEarning: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(SubOrderStatus),
      default: SubOrderStatus.new,
      index: true,
    },
    estimatedDeliveryAt: {
      type: Date,
    },
    cancellation: {
      by: { type: String, enum: ["customer", "vendor", "admin"] },
      reason: { type: String },
      at: { type: Date },
    },
    codAmountToCollect: {
      type: Number,
      min: 0,
    },
    codCollectedBy: {
      type: Schema.Types.ObjectId,
      ref: "RiderProfile",
    },
    codCollectedAt: {
      type: Date,
    },
    codRemittedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    codSettledAt: {
      type: Date,
    },
    settlement: {
      type: String,
      enum: Object.values(SettlementStatus),
      default: SettlementStatus.held,
      index: true,
    },
    releasedAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

subOrderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
subOrderSchema.index({ customerId: 1, createdAt: -1 });
subOrderSchema.index({ currentRiderId: 1, status: 1 });
// FIFO allocation of a rider's COD cash settlements
subOrderSchema.index({ codCollectedBy: 1, settlement: 1, codCollectedAt: 1 });

export const SubOrder = model<ISubOrder>("sub_orders", subOrderSchema);

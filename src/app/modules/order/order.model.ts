import { Schema, model } from "mongoose";
import { fileRefSchema, geoPointSchema } from "../../utils/commonSchemas";
import {
  DeliveryType,
  IAddressSnapshot,
  IOrder,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "./order.interface";

export const addressSnapshotSchema = new Schema<IAddressSnapshot>(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    commune: { type: String, trim: true },
    neighborhood: { type: String, trim: true },
    landmark: { type: String, trim: true },
    directions: { type: String, trim: true },
    location: { type: geoPointSchema, required: true },
    placePhoto: { type: fileRefSchema },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: {
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
    addressSnapshot: {
      type: addressSnapshotSchema,
      required: true,
    },
    deliveryType: {
      type: String,
      enum: Object.values(DeliveryType),
      required: true,
    },
    destinationStationId: {
      type: Schema.Types.ObjectId,
      ref: "TransitStation",
    },
    specialInstructions: {
      type: String,
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.unpaid,
      index: true,
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
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    couponCode: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.active,
      index: true,
    },
    placedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    paymentDueAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
// The unpaid-order sweep (order.payment.service.ts)
orderSchema.index({ paymentDueAt: 1 }, { partialFilterExpression: { paymentStatus: "unpaid" } });

export const Order = model<IOrder>("orders", orderSchema);

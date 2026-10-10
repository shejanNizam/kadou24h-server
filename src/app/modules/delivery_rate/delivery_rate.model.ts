import { Schema, model } from "mongoose";
import {
  DeliveryRateType,
  DeliveryVehicleType,
  IDeliveryRate,
} from "./delivery_rate.interface";

const deliveryRateSchema = new Schema<IDeliveryRate>(
  {
    type: {
      type: String,
      enum: Object.values(DeliveryRateType),
      required: true,
      index: true,
    },
    city: {
      type: String,
      trim: true,
    },
    vehicleType: {
      type: String,
      enum: Object.values(DeliveryVehicleType),
    },
    baseFee: {
      type: Number,
      min: 0,
    },
    perKmFee: {
      type: Number,
      min: 0,
    },
    minFee: {
      type: Number,
      min: 0,
    },
    fromStationId: {
      type: Schema.Types.ObjectId,
      ref: "TransitStation",
    },
    toStationId: {
      type: Schema.Types.ObjectId,
      ref: "TransitStation",
    },
    fee: {
      type: Number,
      min: 0,
    },
    estimatedHours: {
      type: Number,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

deliveryRateSchema.index(
  { type: 1, city: 1, vehicleType: 1 },
  {
    unique: true,
    partialFilterExpression: { type: DeliveryRateType.local },
  },
);

deliveryRateSchema.index(
  { type: 1, fromStationId: 1, toStationId: 1 },
  {
    unique: true,
    partialFilterExpression: { type: DeliveryRateType.intercity },
  },
);

export const DeliveryRate = model<IDeliveryRate>(
  "delivery_rates",
  deliveryRateSchema,
);

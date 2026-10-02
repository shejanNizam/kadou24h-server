import { Schema, model } from "mongoose";
import { fileRefSchema, geoPointSchema } from "../../utils/commonSchemas";
import {
  DeliveryStatus,
  EndpointKind,
  IDelivery,
  LegType,
} from "./delivery.interface";

const deliverySchema = new Schema<IDelivery>(
  {
    subOrderId: {
      type: Schema.Types.ObjectId,
      ref: "sub_orders",
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "orders",
      required: true,
      index: true,
    },
    legNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
    },
    legType: {
      type: String,
      enum: Object.values(LegType),
      required: true,
    },
    riderId: {
      type: Schema.Types.ObjectId,
      ref: "RiderProfile",
      index: true,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    fromKind: {
      type: String,
      enum: Object.values(EndpointKind),
      required: true,
    },
    fromRefId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    fromName: {
      type: String,
      required: true,
      trim: true,
    },
    fromLocation: {
      type: geoPointSchema,
      required: true,
    },
    fromAddressText: {
      type: String,
      trim: true,
    },
    fromPhone: {
      type: String,
      trim: true,
    },
    toKind: {
      type: String,
      enum: Object.values(EndpointKind),
      required: true,
    },
    toRefId: {
      type: Schema.Types.ObjectId,
    },
    toName: {
      type: String,
      required: true,
      trim: true,
    },
    toLocation: {
      type: geoPointSchema,
      required: true,
    },
    toAddressText: {
      type: String,
      trim: true,
    },
    toPhone: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(DeliveryStatus),
      default: DeliveryStatus.pending_assignment,
      index: true,
    },
    fee: {
      type: Number,
      required: true,
      min: 0,
    },
    pickupPin: {
      type: String,
      required: true,
    },
    pickupPinHash: {
      type: String,
      required: true,
    },
    handoverPin: {
      type: String,
      required: true,
    },
    handoverPinHash: {
      type: String,
      required: true,
    },
    pinAttempts: {
      type: Number,
      default: 0,
    },
    pinLockedUntil: {
      type: Date,
    },
    collectsCash: {
      type: Boolean,
      default: false,
    },
    proofPhoto: {
      type: fileRefSchema,
    },
    declineReason: {
      type: String,
      trim: true,
    },
    assignedAt: {
      type: Date,
    },
    acceptedAt: {
      type: Date,
    },
    pickedUpAt: {
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

deliverySchema.index({ subOrderId: 1, legNumber: 1 });
deliverySchema.index({ riderId: 1, status: 1 });
deliverySchema.index({ status: 1, createdAt: -1 });

export const Delivery = model<IDelivery>("deliveries", deliverySchema);

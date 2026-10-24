import { model, Schema } from "mongoose";
import { geoPointSchema } from "../../utils/commonSchemas";
import { reviewFields, verificationDocumentSchema } from "../profile_common/profile.common";
import {
  IRiderProfile,
  PartnerType,
  RiderDocumentType,
  VehicleType,
} from "./rider_profile.interface";

const riderProfileSchema = new Schema<IRiderProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    partnerType: { type: String, enum: Object.values(PartnerType) },
    vehicle: {
      type: { type: String, enum: Object.values(VehicleType) },
      color: { type: String, trim: true },
      brand: { type: String, trim: true },
      plateNumber: { type: String, trim: true, uppercase: true },
    },
    vestNumber: { type: String, trim: true },
    cityArea: { type: String, trim: true },
    nationalIdNumber: { type: String, trim: true },
    transitRoutes: {
      type: [
        new Schema(
          {
            fromStationId: { type: Schema.Types.ObjectId, ref: "TransitStation", required: true },
            toStationId: { type: Schema.Types.ObjectId, ref: "TransitStation", required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    documents: {
      type: [verificationDocumentSchema(Object.values(RiderDocumentType))],
      default: [],
    },
    isOnline: { type: Boolean, default: false },
    lastLocation: { type: geoPointSchema },
    lastLocationAt: { type: Date },
    activeDeliveryCount: { type: Number, default: 0 },
    cashLimit: { type: Number },
    stats: {
      ratingAvg: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
      totalDeliveries: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      cancelled: { type: Number, default: 0 },
    },
    // Moto-taxi rides (passengers rate the rider)
    rideStats: {
      completed: { type: Number, default: 0 },
      ratingAvg: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
    },
    rideAccessUntil: { type: Date },
    rideTrialUsedAt: { type: Date },
    ...reviewFields,
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

riderProfileSchema.index({ approvalStatus: 1, partnerType: 1 });
riderProfileSchema.index({ lastLocation: "2dsphere" });
riderProfileSchema.index({ "transitRoutes.fromStationId": 1, "transitRoutes.toStationId": 1 });

export const RiderProfile = model<IRiderProfile>("RiderProfile", riderProfileSchema);

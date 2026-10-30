import { Schema, model } from "mongoose";
import { geoPointSchema } from "../../utils/commonSchemas";
import { IRide, RideStatus } from "./ride.interface";

const placeSchema = new Schema(
  {
    location: { type: geoPointSchema, required: true },
    address: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const rideSchema = new Schema<IRide>(
  {
    rideNumber: { type: String, required: true, unique: true },
    passengerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    riderId: { type: Schema.Types.ObjectId, ref: "RiderProfile", index: true },
    status: { type: String, enum: Object.values(RideStatus), default: RideStatus.searching, index: true },
    pickup: { type: placeSchema, required: true },
    dropoff: { type: placeSchema, required: true },
    distanceKm: { type: Number, required: true, min: 0 },
    durationMin: { type: Number, required: true, min: 0 },
    fare: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 200 },
    searchStartedAt: { type: Date, default: Date.now },
    offerRadiusKm: { type: Number, default: 0 },
    offerNotified: { type: [Schema.Types.ObjectId], default: undefined, select: false },
    offerSkippedBy: { type: [Schema.Types.ObjectId], default: undefined, select: false },
    acceptedAt: { type: Date },
    arrivedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancellation: {
      by: { type: String, enum: ["passenger", "rider", "admin"] },
      reason: { type: String, trim: true, maxlength: 300 },
      at: { type: Date },
    },
    rating: {
      stars: { type: Number, min: 1, max: 5 },
      comment: { type: String, trim: true, maxlength: 500 },
      at: { type: Date },
    },
    shareToken: { type: String, select: false },
    hiddenByPassengerAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

rideSchema.index({ status: 1, createdAt: 1 });
rideSchema.index({ passengerId: 1, createdAt: -1 });
rideSchema.index({ riderId: 1, status: 1 });
rideSchema.index({ shareToken: 1 }, { unique: true, sparse: true });

export const Ride = model<IRide>("rides", rideSchema);

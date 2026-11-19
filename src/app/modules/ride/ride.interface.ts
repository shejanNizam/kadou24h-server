import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

/**
 * Moto-taxi ride (point A → point B), client 2026-10-23: "structure it as you see fit,
 * like the platforms in Guinea". The price is fixed before the request, nearby moto
 * riders get the request (nearest first), the first to accept takes it, and the
 * passenger pays the rider in cash.
 */
export enum RideStatus {
  searching = "searching", // waiting for a rider
  accepted = "accepted", // a rider is coming to the pickup point
  arrived = "arrived", // the rider is at the pickup point
  in_progress = "in_progress", // on the way to the destination
  completed = "completed",
  cancelled = "cancelled",
  expired = "expired", // nobody accepted in time
}

export type RideCancelledBy = "passenger" | "rider" | "admin";

export interface IRidePlace {
  location: IGeoPoint;
  /** Shown to both: neighbourhood, street, landmark */
  address: string;
}

export interface IRideInitial {
  rideNumber: string;
  passengerId: Types.ObjectId;
  riderId?: Types.ObjectId; // RiderProfile
  status: RideStatus;
  pickup: IRidePlace;
  dropoff: IRidePlace;
  /** Road estimate (straight line × road factor) */
  distanceKm: number;
  durationMin: number;
  /** GNF, fixed at the request: what the passenger pays the rider in cash */
  fare: number;
  note?: string;
  /** The passenger's photo of the pickup spot (gate, landmark): riders see it to find them */
  pickupPhoto?: IFileRef;
  // Open dispatch, like deliveries: nearby riders see it, the radius grows from here
  searchStartedAt: Date;
  offerRadiusKm: number;
  offerNotified?: Types.ObjectId[];
  offerSkippedBy?: Types.ObjectId[];
  acceptedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancellation?: { by: RideCancelledBy; reason?: string; at: Date };
  /** The passenger's rating of the rider */
  rating?: { stars: number; comment?: string; at: Date };
  /** "Share my trip": a close one follows the ride from this link; it closes when the ride ends */
  shareToken?: string;
  /** The passenger deleted it from their history: hidden for them only */
  hiddenByPassengerAt?: Date;
}

export type IRide = IRideInitial & Document;

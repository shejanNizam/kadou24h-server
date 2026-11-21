import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

/**
 * Moto-taxi ride (point A → point B), client 2026-10-23: "structure it as you see fit,
 * like the platforms in Guinea". Kadou24h suggests the price; since 2026-11-21 the price is
 * negotiable (client): nearby riders answer with a price (the suggested one, or up to
 * settings.rides.maxRaisePercent more), the passenger picks one or counter-offers, and pays
 * the rider in cash.
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

/**
 * A rider's price for a searching ride.
 * pending → (passenger) accepted | declined | countered → (rider) accepted | declined.
 * withdrawn: the rider took it back; expired: nobody answered in time.
 */
export enum RideBidStatus {
  pending = "pending",
  countered = "countered",
  accepted = "accepted",
  declined = "declined",
  withdrawn = "withdrawn",
  expired = "expired",
}

export interface IRideBid {
  _id: Types.ObjectId;
  riderId: Types.ObjectId; // RiderProfile
  /** GNF the rider asks: suggested fare ≤ price ≤ maxFare */
  price: number;
  /** GNF the passenger proposes back: suggested fare ≤ counterPrice < price */
  counterPrice?: number;
  status: RideBidStatus;
  /** How far the rider was from the pickup when bidding */
  pickupKm: number;
  /** The other side must answer before this */
  expiresAt: Date;
  createdAt: Date;
}

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
  /** GNF the passenger pays the rider in cash: the suggested price while searching, the agreed one once a rider is chosen */
  fare: number;
  /** GNF, Kadou24h's price at the request (older rides: = fare) */
  suggestedFare?: number;
  /** GNF, the most a rider may ask for this ride (suggested + maxRaisePercent at the request) */
  maxFare?: number;
  bids?: IRideBid[];
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

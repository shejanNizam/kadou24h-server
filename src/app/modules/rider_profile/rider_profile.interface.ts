import { Document, Types } from "mongoose";
import { IGeoPoint } from "../../interfaces/common.types";
import { IReviewable, IVerificationDocument } from "../profile_common/profile.common";

export enum PartnerType {
  moto = "moto", // local first / last mile
  transit = "transit", // bus driver, station → station
}

export enum VehicleType {
  motorbike = "motorbike",
  bicycle = "bicycle",
  car = "car",
  bus = "bus",
  minibus = "minibus",
}

export const VEHICLES_BY_PARTNER: Record<PartnerType, VehicleType[]> = {
  [PartnerType.moto]: [VehicleType.motorbike, VehicleType.bicycle, VehicleType.car],
  [PartnerType.transit]: [VehicleType.bus, VehicleType.minibus, VehicleType.car],
};

/**
 * What a customer or passenger checks before handing over a parcel or getting on:
 * a motorised moto partner needs a plate; a moto-taxi (motorbike) also its vest number.
 */
export const missingSafetyIds = (p: { partnerType?: PartnerType; vehicle?: IVehicle; vestNumber?: string }) => {
  const moto = p.partnerType === PartnerType.moto;
  const type = p.vehicle?.type;
  const needsPlate = moto && (type === VehicleType.motorbike || type === VehicleType.car);
  const needsVest = moto && type === VehicleType.motorbike;
  return [
    needsPlate && !p.vehicle?.plateNumber?.trim() && "vehicle.plateNumber",
    needsVest && !p.vestNumber?.trim() && "vestNumber",
  ].filter(Boolean) as string[];
};

export enum RiderDocumentType {
  driver_license = "driver_license",
  national_id = "national_id",
  vehicle_registration = "vehicle_registration",
}

export interface IVehicle {
  type?: VehicleType;
  color?: string;
  brand?: string;
  plateNumber?: string;
}

export interface ITransitRoute {
  fromStationId: Types.ObjectId;
  toStationId: Types.ObjectId;
}

export interface IRiderStats {
  ratingAvg: number;
  ratingCount: number;
  totalDeliveries: number;
  completed: number;
  cancelled: number;
}

export interface IRiderProfileInitial extends Omit<IReviewable, "_id"> {
  userId: Types.ObjectId;
  partnerType?: PartnerType;
  vehicle: IVehicle;
  vestNumber?: string;
  cityArea?: string;
  nationalIdNumber?: string;
  transitRoutes: ITransitRoute[];
  documents: Types.DocumentArray<IVerificationDocument & Document>;
  // Live state — managed in Step 5 (deliveries)
  isOnline: boolean;
  lastLocation?: IGeoPoint;
  lastLocationAt?: Date;
  activeDeliveryCount: number;
  cashLimit?: number; // GNF; empty = settings.riderCashLimitDefault
  stats: IRiderStats;
  rideStats?: { completed: number; ratingAvg: number; ratingCount: number };
  // Moto-taxi subscription (only checked while settings.rides.subscriptionRequired is on)
  rideAccessUntil?: Date;
  rideTrialUsedAt?: Date;
}

export type IRiderProfile = IRiderProfileInitial & Document;

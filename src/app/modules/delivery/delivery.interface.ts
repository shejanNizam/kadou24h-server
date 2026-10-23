import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

export enum LegType {
  local = "local",
  first_mile = "first_mile",
  line_haul = "line_haul",
  last_mile = "last_mile",
}

export enum DeliveryStatus {
  pending_assignment = "pending_assignment",
  assigned = "assigned",
  accepted = "accepted",
  declined = "declined",
  going_to_pickup = "going_to_pickup",
  picked_up = "picked_up",
  in_transit = "in_transit",
  delivered = "delivered",
  cancelled = "cancelled",
}

export enum EndpointKind {
  vendor = "vendor",
  station = "station",
  customer = "customer",
}

export interface IDeliveryInitial {
  subOrderId: Types.ObjectId;
  orderId: Types.ObjectId;
  legNumber: number;
  legType: LegType;
  riderId?: Types.ObjectId;
  assignedBy?: Types.ObjectId;
  fromKind: EndpointKind;
  fromRefId: Types.ObjectId;
  fromName: string;
  fromLocation: IGeoPoint;
  fromAddressText?: string;
  fromPhone?: string;
  toKind: EndpointKind;
  toRefId?: Types.ObjectId;
  toName: string;
  toLocation: IGeoPoint;
  toAddressText?: string;
  toPhone?: string;
  status: DeliveryStatus;
  fee: number; // GNF — 100% to partner
  pickupPin: string;
  pickupPinHash: string;
  handoverPin: string;
  handoverPinHash: string;
  pinAttempts: number;
  pinLockedUntil?: Date;
  collectsCash: boolean;
  proofPhoto?: IFileRef;
  declineReason?: string;
  // Open dispatch (client, 2026-10-23): nearby riders see the leg, the first to accept takes it
  offerOpenedAt?: Date; // visible to riders since
  offerRadiusKm?: number; // how far the offer has reached so far
  offerNotified?: Types.ObjectId[]; // riders already told (RiderProfile ids)
  offerSkippedBy?: Types.ObjectId[]; // riders who passed or declined: not shown again
  noRiderAlertedAt?: Date; // store + Kadou24h told that nobody took it
  reservedUntil?: Date; // a rider picked by the store must accept before this
  assignedAt?: Date;
  acceptedAt?: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
}

export type IDelivery = IDeliveryInitial & Document;

export interface IAvailableRider {
  _id: string;
  userId: string;
  name: string;
  avatar?: string;
  partnerType: string;
  vehicleType: string;
  vehicleBrand?: string;
  plateNumber?: string;
  isLinked: boolean;
  servesRoute?: boolean; // bus leg: the driver runs this station → station route
  ratingAvg: number;
  totalDeliveries: number;
  activeDeliveryCount: number;
  distanceKm?: number;
  currentLocation?: [number, number];
}

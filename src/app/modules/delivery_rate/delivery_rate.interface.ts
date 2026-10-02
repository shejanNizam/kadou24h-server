import { Document, Types } from "mongoose";

export enum DeliveryRateType {
  local = "local",
  intercity = "intercity",
}

export enum DeliveryVehicleType {
  motorbike = "motorbike",
  bicycle = "bicycle",
  car = "car",
  bus = "bus",
  minibus = "minibus",
}

export interface IDeliveryRateInitial {
  type: DeliveryRateType;
  city?: string;
  vehicleType?: DeliveryVehicleType;
  baseFee?: number;
  perKmFee?: number;
  minFee?: number;
  fromStationId?: Types.ObjectId;
  toStationId?: Types.ObjectId;
  fee?: number;
  estimatedHours?: number;
  isActive: boolean;
  updatedBy?: Types.ObjectId;
}

export type IDeliveryRate = IDeliveryRateInitial & Document;

export interface ICalculateRateParams {
  type: DeliveryRateType;
  vendorLocation?: [number, number]; // [lng, lat]
  customerLocation?: [number, number]; // [lng, lat]
  city?: string;
  vehicleType?: DeliveryVehicleType;
  fromStationId?: string;
  toStationId?: string;
}

export interface ICalculateRateResult {
  type: DeliveryRateType;
  distanceKm?: number;
  fee: number;
  estimatedHours?: number;
  breakdown?: {
    baseFee?: number;
    perKmFee?: number;
    minFee?: number;
    distanceFee?: number;
  };
}

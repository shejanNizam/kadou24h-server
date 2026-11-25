import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditLogServices } from "../audit_log/audit_log.service";
import {
  DeliveryRateType,
  DeliveryVehicleType,
  ICalculateRateParams,
  ICalculateRateResult,
  IDeliveryRateInitial,
} from "./delivery_rate.interface";
import { DeliveryRate } from "./delivery_rate.model";
import { containsRegex, escapeRegex } from "../../utils/queryParams";
import { SettingsServices } from "../settings/settings.service";

export interface IntercityLegFees {
  firstMile: number;
  lineHaul: number;
  lastMile: number;
}

/**
 * How a route fare is shared (client, 2026-11-25): the two motos get the amounts set in
 * settings.intercity, the bus gets the rest. Pickup at the station has no last moto, so
 * the customer pays the fare minus that moto. Total = what the customer pays.
 */
export const splitIntercityFare = async (fare: number, stationPickup: boolean) => {
  const { intercity } = await SettingsServices.getSettings();
  const firstMile = intercity?.firstMileFee ?? 10000;
  const lastMile = intercity?.lastMileFee ?? 10000;
  const legs: IntercityLegFees = {
    firstMile,
    lineHaul: Math.max(0, fare - firstMile - lastMile),
    lastMile: stationPickup ? 0 : lastMile,
  };
  return { legs, total: legs.firstMile + legs.lineHaul + legs.lastMile };
};

/** A route fare must leave something for the bus after paying both motos */
const checkFareCoversMotos = async (type?: DeliveryRateType, fee?: number) => {
  if (type !== DeliveryRateType.intercity || fee === undefined) return;
  const { intercity } = await SettingsServices.getSettings();
  const motos = (intercity?.firstMileFee ?? 10000) + (intercity?.lastMileFee ?? 10000);
  if (fee <= motos) throw new AppError(httpStatus.BAD_REQUEST, "INTERCITY_FARE_TOO_LOW", { motos });
};

/**
 * Calculates Haversine distance in KM between two [lng, lat] coordinates.
 */
export const calculateDistanceKm = (
  coord1: [number, number],
  coord2: [number, number],
): number => {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371; // Earth radius in KM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

/**
 * Calculates delivery fee for either local distance-based or intercity fixed-fare routes.
 */
const calculateDeliveryFee = async (
  params: ICalculateRateParams,
): Promise<ICalculateRateResult> => {
  if (params.type === DeliveryRateType.intercity) {
    if (!params.fromStationId || !params.toStationId) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "STATIONS_REQUIRED",
      );
    }

    const rate = await DeliveryRate.findOne({
      type: DeliveryRateType.intercity,
      fromStationId: params.fromStationId,
      toStationId: params.toStationId,
      isActive: true,
    });

    if (!rate || rate.fee === undefined) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        "NO_INTERCITY_ROUTE",
      );
    }

    return {
      type: DeliveryRateType.intercity,
      fee: rate.fee,
      estimatedHours: rate.estimatedHours,
    };
  }

  // Local distance calculation
  if (!params.vendorLocation || !params.customerLocation) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "LOCATIONS_REQUIRED",
    );
  }

  const distanceKm = calculateDistanceKm(
    params.vendorLocation,
    params.customerLocation,
  );

  const vehicleType = params.vehicleType || DeliveryVehicleType.motorbike;

  // Look up rate by city & vehicleType
  let rate = null;
  if (params.city) {
    rate = await DeliveryRate.findOne({
      type: DeliveryRateType.local,
      city: new RegExp(`^${escapeRegex(params.city)}$`, "i"),
      vehicleType,
      isActive: true,
    });
  }

  // If not found, look up any local rate for this vehicle
  if (!rate) {
    rate = await DeliveryRate.findOne({
      type: DeliveryRateType.local,
      vehicleType,
      isActive: true,
    });
  }

  // Fallback defaults if no rate rule is seeded in DB yet
  const baseFee = rate?.baseFee ?? 5000;
  const perKmFee = rate?.perKmFee ?? 1000;
  const minFee = rate?.minFee ?? 7000;

  const distanceFee = Math.ceil(distanceKm * perKmFee);
  const totalFee = Math.max(minFee, baseFee + distanceFee);

  return {
    type: DeliveryRateType.local,
    distanceKm,
    fee: totalFee,
    breakdown: {
      baseFee,
      perKmFee,
      minFee,
      distanceFee,
    },
  };
};

const createDeliveryRate = async (
  payload: IDeliveryRateInitial,
  actorId: string,
) => {
  await checkFareCoversMotos(payload.type, payload.fee);
  const rate = await DeliveryRate.create({
    ...payload,
    updatedBy: actorId,
  });

  await AuditLogServices.record({
    actorId,
    action: "delivery_rate.create",
    targetType: "delivery_rate",
    targetId: String(rate._id),
    after: {
      type: rate.type,
      city: rate.city,
      vehicleType: rate.vehicleType,
      fee: rate.fee,
      minFee: rate.minFee,
    },
  });

  return rate;
};

const getAllDeliveryRates = async (query: {
  type?: DeliveryRateType;
  city?: string;
  isActive?: boolean;
}) => {
  const filter: Record<string, unknown> = {};
  if (query.type) filter.type = query.type;
  if (query.city) filter.city = containsRegex(query.city);
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  return DeliveryRate.find(filter)
    .populate("fromStationId", "name city location")
    .populate("toStationId", "name city location")
    .sort({ createdAt: -1 });
};

const getDeliveryRateById = async (id: string) => {
  const rate = await DeliveryRate.findById(id)
    .populate("fromStationId", "name city location")
    .populate("toStationId", "name city location");

  if (!rate) {
    throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_RATE_NOT_FOUND");
  }
  return rate;
};

const updateDeliveryRate = async (
  id: string,
  payload: Partial<IDeliveryRateInitial>,
  actorId: string,
) => {
  if (payload.fee !== undefined) {
    const current = await DeliveryRate.findById(id).select("type");
    await checkFareCoversMotos(payload.type ?? current?.type, payload.fee);
  }
  const rate = await DeliveryRate.findByIdAndUpdate(
    id,
    { $set: { ...payload, updatedBy: actorId } },
    { returnDocument: "after", runValidators: true },
  );

  if (!rate) {
    throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_RATE_NOT_FOUND");
  }

  await AuditLogServices.record({
    actorId,
    action: "delivery_rate.update",
    targetType: "delivery_rate",
    targetId: id,
    after: payload as Record<string, unknown>,
  });

  return rate;
};

const deleteDeliveryRate = async (id: string, actorId: string) => {
  const rate = await DeliveryRate.findByIdAndUpdate(
    id,
    { $set: { isActive: false, updatedBy: actorId } },
    { returnDocument: "after" },
  );

  if (!rate) {
    throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_RATE_NOT_FOUND");
  }

  await AuditLogServices.record({
    actorId,
    action: "delivery_rate.deactivate",
    targetType: "delivery_rate",
    targetId: id,
  });

  return rate;
};

export const DeliveryRateServices = {
  calculateDistanceKm,
  calculateDeliveryFee,
  createDeliveryRate,
  getAllDeliveryRates,
  getDeliveryRateById,
  updateDeliveryRate,
  deleteDeliveryRate,
};

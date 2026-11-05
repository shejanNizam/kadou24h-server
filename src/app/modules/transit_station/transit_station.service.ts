import httpStatus from "http-status";
import { ILatLng } from "../../interfaces/common.types";
import AppError from "../../errorHelpers/AppError";
import { fromGeoPoint, toGeoPoint } from "../../utils/commonSchemas";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { ITransitStation, ITransitStationInitial } from "./transit_station.interface";
import { TransitStation } from "./transit_station.model";

type StationInput = Partial<Omit<ITransitStationInitial, "location">> & { location?: ILatLng };

const present = (station: ITransitStation | ITransitStationInitial) => {
  const obj = "toObject" in station ? station.toObject() : station;
  return { ...obj, location: fromGeoPoint(obj.location) };
};

/** Throws unless every id is an active station. Used by rider applications. */
const assertStations = async (ids: string[]) => {
  const unique = [...new Set(ids)];
  const count = await TransitStation.countDocuments({ _id: { $in: unique }, isActive: true });
  if (count !== unique.length) {
    throw new AppError(httpStatus.BAD_REQUEST, "STATIONS_INVALID");
  }
};

const getStations = async (query: Record<string, string>, includeInactive = false) => {
  const filter: Record<string, unknown> = includeInactive ? {} : { isActive: true };
  if (query.city) filter.city = new RegExp(`^${query.city.replace(/[.*+?^${}()|[\]\\]/g, "")}$`, "i");
  const stations = await TransitStation.find(filter).sort({ city: 1, name: 1 }).lean();
  return stations.map(present);
};

const createStation = async (payload: StationInput, actorId: string) => {
  const station = await TransitStation.create({
    ...payload,
    location: toGeoPoint(payload.location as ILatLng),
  });
  await AuditLogServices.record({
    actorId,
    action: "transit_station.create",
    targetType: "transit_station",
    targetId: String(station._id),
    after: { name: station.name, city: station.city },
  });
  return present(station);
};

const updateStation = async (id: string, payload: StationInput, actorId: string) => {
  const { location, ...rest } = payload;
  const station = await TransitStation.findByIdAndUpdate(
    id,
    { $set: { ...rest, ...(location && { location: toGeoPoint(location) }) } },
    { returnDocument: "after", runValidators: true },
  );
  if (!station) throw new AppError(httpStatus.NOT_FOUND, "STATION_NOT_FOUND");

  await AuditLogServices.record({
    actorId,
    action: "transit_station.update",
    targetType: "transit_station",
    targetId: id,
    after: payload as Record<string, unknown>,
  });
  return present(station);
};

export const TransitStationServices = {
  assertStations,
  getStations,
  createStation,
  updateStation,
};

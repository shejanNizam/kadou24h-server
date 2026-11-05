/**
 * Moto-taxi (point A → point B), client 2026-10-23.
 *
 * - Price fixed before the request: max(minFare, baseFare + perKm × road km), rounded up to
 *   500 GNF (settings.rides, set by Kadou24h). Paid in cash to the rider at the end.
 * - Open dispatch like deliveries: available moto riders near the pickup get the request,
 *   the radius grows every minute, the first to accept takes it. Nobody in 10 min → expired.
 * - Available = approved moto rider, online, a recent position, no parcel on board and no
 *   other ride.
 * - Steps: accepted → arrived → in_progress → completed. The passenger may cancel until the
 *   ride starts; a rider who drops it before the start sends it back to the other riders.
 * - Privacy: the passenger never gets the rider's phone (client rule); the rider gets the
 *   passenger's phone once they accepted, to find them.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import type { ErrorCode } from "../../i18n/errors";
import { emitToUser } from "../../../socket/socket";
import { ILatLng } from "../../interfaces/common.types";
import { toGeoPoint } from "../../utils/commonSchemas";
import { logger } from "../../utils/logger";
import { escapeRegex } from "../../utils/queryParams";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { CounterServices } from "../counter/counter.service";
import { calculateDistanceKm } from "../delivery_rate/delivery_rate.service";
import { ApprovalStatus } from "../profile_common/profile.common";
import { IVehicle, missingSafetyIds, PartnerType } from "../rider_profile/rider_profile.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { rideAccessFilter, rideAccessState, startRideTrialIfFirst } from "../rider_profile/ride_access";
import { User } from "../user/user.model";
import { IRide, RideStatus } from "./ride.interface";
import { Ride } from "./ride.model";
import { RideNotify } from "./ride.notify";

export const RIDE = {
  sweepEveryMs: Number(process.env.RIDE_SWEEP_MS) || 15_000,
  /** Straight line → road distance */
  roadFactor: 1.3,
  /** Average moto speed in town, for the time estimate */
  speedKmh: 22,
  roundTo: 500,
  /** [minutes since the search started, radius in km] */
  radiusSteps: [
    [0, 2],
    [1, 4],
    [2, 7],
    [4, 10],
  ] as const,
  /** Nobody accepted after this → expired */
  searchMinutes: 10,
  locationFreshMinutes: 15,
  minKm: 0.3,
  maxKm: 80,
} as const;

const MINUTE = 60_000;
/** A ride that holds its passenger and its rider */
export const ACTIVE_RIDE = [RideStatus.searching, RideStatus.accepted, RideStatus.arrived, RideStatus.in_progress];
const WITH_RIDER = [RideStatus.accepted, RideStatus.arrived, RideStatus.in_progress];
const round1 = (n: number) => Math.round(n * 10) / 10;

const radiusAt = (since: Date, now = Date.now()) => {
  const minutes = (now - since.getTime()) / MINUTE;
  let radius: number = RIDE.radiusSteps[0][1];
  for (const [after, km] of RIDE.radiusSteps) if (minutes >= after) radius = km;
  return radius;
};

interface PlaceInput extends ILatLng {
  address: string;
}

// ── Price ────────────────────────────────────────────────────────────

const quote = async (pickup: ILatLng, dropoff: ILatLng) => {
  const settings = await SettingsServices.getSettings();
  const rides = settings.rides ?? { enabled: true, baseFare: 3000, perKm: 1500, minFare: 5000 };
  if (rides.enabled === false) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_SERVICE_OFF");
  const straight = calculateDistanceKm([pickup.lng, pickup.lat], [dropoff.lng, dropoff.lat]);
  if (straight < RIDE.minKm) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_TOO_CLOSE");
  const distanceKm = round1(straight * RIDE.roadFactor);
  if (distanceKm > RIDE.maxKm) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_TOO_LONG");
  const raw = rides.baseFare + rides.perKm * distanceKm;
  const fare = Math.max(rides.minFare, Math.ceil(raw / RIDE.roundTo) * RIDE.roundTo);
  const durationMin = Math.max(3, Math.round((distanceKm / RIDE.speedKmh) * 60));
  return { distanceKm, durationMin, fare };
};

// ── Who can take a ride ──────────────────────────────────────────────

interface RiderLite {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  lastLocation?: { coordinates: [number, number] };
  lastLocationAt?: Date;
  activeDeliveryCount?: number;
  isOnline?: boolean;
  partnerType?: PartnerType;
  approvalStatus?: ApprovalStatus;
  rideAccessUntil?: Date;
  rideTrialUsedAt?: Date;
  vehicle?: IVehicle;
  vestNumber?: string;
}

const RIDER_FIELDS =
  "userId lastLocation lastLocationAt activeDeliveryCount isOnline partnerType approvalStatus rideAccessUntil rideTrialUsedAt vehicle vestNumber";

const rideSettings = async () => (await SettingsServices.getSettings()).rides;

/** Online moto riders with a recent position, no parcel and no ride; with their distance to a point */
const availableRiders = async (point: [number, number], now = Date.now()) => {
  const rides = await rideSettings();
  const [riders, busy] = await Promise.all([
    RiderProfile.find({
      approvalStatus: ApprovalStatus.approved,
      partnerType: PartnerType.moto,
      isOnline: true,
      activeDeliveryCount: { $lte: 0 },
      lastLocationAt: { $gte: new Date(now - RIDE.locationFreshMinutes * MINUTE) },
      // Subscription on: only riders paid up or still in their free period
      ...rideAccessFilter(rides, new Date(now)),
    })
      .select(RIDER_FIELDS)
      .lean<RiderLite[]>(),
    Ride.distinct("riderId", { status: { $in: WITH_RIDER } }),
  ]);
  const onRide = new Set(busy.map(String));
  // A passenger must be able to check the plate and vest
  return riders
    .filter((r) => r.lastLocation?.coordinates && !onRide.has(String(r._id)) && missingSafetyIds(r).length === 0)
    .map((r) => ({ rider: r, km: round1(calculateDistanceKm(point, r.lastLocation!.coordinates)) }));
};

/** Why this rider can't take a ride now (null = can) */
const riderBlocker = async (rider: RiderLite): Promise<ErrorCode | null> => {
  if (rider.approvalStatus !== ApprovalStatus.approved || rider.partnerType !== PartnerType.moto) {
    return "RIDE_ONLY_MOTO";
  }
  if (missingSafetyIds(rider).length) {
    return "RIDE_SAFETY_IDS_MISSING";
  }
  if (!rideAccessState(rider, await rideSettings()).allowed) {
    return "RIDE_SUBSCRIPTION_ENDED";
  }
  if (!rider.isOnline) return "GO_ONLINE_FOR_RIDES";
  if ((rider.activeDeliveryCount ?? 0) > 0) return "FINISH_DELIVERIES_FIRST";
  if (await Ride.exists({ riderId: rider._id, status: { $in: WITH_RIDER } })) return "FINISH_CURRENT_RIDE";
  return null;
};

// ── Views ────────────────────────────────────────────────────────────

type Populated = Omit<IRide, "riderId" | "passengerId"> & {
  _id: Types.ObjectId;
  passengerId: { _id: Types.ObjectId; name?: string; avatar?: { url?: string }; phone?: string } | Types.ObjectId;
  riderId?: {
    _id: Types.ObjectId;
    userId?: { _id: Types.ObjectId; name?: string; avatar?: { url?: string } };
    vehicle?: { type?: string; brand?: string; model?: string; color?: string; plateNumber?: string };
    vestNumber?: string;
    rideStats?: { ratingAvg?: number; ratingCount?: number; completed?: number };
    lastLocation?: { coordinates: [number, number] };
    lastLocationAt?: Date;
  } | null;
};

const POPULATE = [
  { path: "passengerId", select: "name avatar phone" },
  {
    path: "riderId",
    select: "userId vehicle vestNumber rideStats lastLocation lastLocationAt",
    populate: { path: "userId", select: "name avatar" },
  },
];

/**
 * One ride as the passenger, the rider or the team sees it. The passenger gets the rider's
 * name, photo, vehicle, rating and live position — never the phone. The rider gets the
 * passenger's phone once they accepted.
 */
const present = (ride: Populated, as: "passenger" | "rider" | "admin") => {
  const passenger = ride.passengerId && "_id" in ride.passengerId && !(ride.passengerId instanceof Types.ObjectId) ? ride.passengerId : null;
  const rider = ride.riderId ?? null;
  const live = WITH_RIDER.includes(ride.status);
  return {
    _id: ride._id,
    rideNumber: ride.rideNumber,
    status: ride.status,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    distanceKm: ride.distanceKm,
    durationMin: ride.durationMin,
    fare: ride.fare,
    note: ride.note,
    searchStartedAt: ride.searchStartedAt,
    acceptedAt: ride.acceptedAt,
    arrivedAt: ride.arrivedAt,
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    cancellation: ride.cancellation?.by ? ride.cancellation : undefined,
    rating: ride.rating?.stars ? ride.rating : undefined,
    createdAt: (ride as unknown as { createdAt: Date }).createdAt,
    role: as,
    passenger: passenger
      ? {
          _id: passenger._id,
          name: passenger.name,
          avatar: passenger.avatar,
          ...((as === "admin" || (as === "rider" && live)) && { phone: passenger.phone }),
        }
      : undefined,
    rider: rider
      ? {
          _id: rider._id,
          name: rider.userId?.name,
          avatar: rider.userId?.avatar,
          vehicle: rider.vehicle,
          // The passenger checks plate + vest before getting on
          vestNumber: rider.vestNumber,
          rating: rider.rideStats?.ratingAvg ?? 0,
          ratingCount: rider.rideStats?.ratingCount ?? 0,
          rides: rider.rideStats?.completed ?? 0,
          // Live position only while the rider is on this ride
          ...(live && rider.lastLocation && { location: rider.lastLocation, locationAt: rider.lastLocationAt }),
        }
      : undefined,
  };
};

const loadRide = (id: string) =>
  Types.ObjectId.isValid(id) ? Ride.findById(id).populate(POPULATE).lean<Populated>() : Promise.resolve(null);

// ── Passenger ───────────────────────────────────────────────────────

const estimate = async (passengerId: string, payload: { pickup: ILatLng; dropoff: ILatLng }) => {
  const price = await quote(payload.pickup, payload.dropoff);
  const nearby = await availableRiders([payload.pickup.lng, payload.pickup.lat]);
  const ridersNearby = nearby.filter((r) => r.km <= RIDE.radiusSteps.at(-1)![1] && String(r.rider.userId) !== passengerId).length;
  return { ...price, ridersNearby };
};

const requestRide = async (passengerId: string, payload: { pickup: PlaceInput; dropoff: PlaceInput; note?: string }) => {
  if (await Ride.exists({ passengerId, status: { $in: ACTIVE_RIDE } })) {
    throw new AppError(httpStatus.CONFLICT, "RIDE_IN_PROGRESS");
  }
  const price = await quote(payload.pickup, payload.dropoff);
  const now = new Date();
  const ride = await Ride.create({
    rideNumber: await CounterServices.nextCode("ride"),
    passengerId: new Types.ObjectId(passengerId),
    status: RideStatus.searching,
    pickup: { location: toGeoPoint(payload.pickup), address: payload.pickup.address },
    dropoff: { location: toGeoPoint(payload.dropoff), address: payload.dropoff.address },
    ...price,
    note: payload.note,
    searchStartedAt: now,
    offerRadiusKm: RIDE.radiusSteps[0][1],
  });
  await announce(ride._id);
  return present((await loadRide(String(ride._id)))!, "passenger");
};

const getRide = async (userId: string, id: string, isStaff = false) => {
  const ride = await loadRide(id);
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  const passengerId = String((ride.passengerId as { _id?: Types.ObjectId })._id ?? ride.passengerId);
  if (passengerId === userId) return present(ride, "passenger");
  if (ride.riderId && String(ride.riderId.userId?._id) === userId) return present(ride, "rider");
  if (isStaff) return present(ride, "admin");
  throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
};

const getMyRides = async (passengerId: string, query: { page?: string; limit?: string }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  // Requests nobody took stay listed (client, 2026-10-30): the passenger can delete any finished ride
  const filter = { passengerId: new Types.ObjectId(passengerId), hiddenByPassengerAt: { $exists: false } };
  const [rows, total] = await Promise.all([
    Ride.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<Populated[]>(),
    Ride.countDocuments(filter),
  ]);
  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, data: rows.map((r) => present(r, "passenger")) };
};

/** "Delete from my history": hidden for the passenger only (the rider and admin keep it). Only a finished ride. */
const hideMyRide = async (passengerId: string, id: string) => {
  const ride = Types.ObjectId.isValid(id) ? await Ride.findOne({ _id: id, passengerId }).select("status").lean() : null;
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  if (ACTIVE_RIDE.includes(ride.status)) {
    throw new AppError(httpStatus.BAD_REQUEST, "RIDE_DELETE_IN_PROGRESS");
  }
  await Ride.updateOne({ _id: ride._id }, { $set: { hiddenByPassengerAt: new Date() } });
};

/** The passenger's running ride (the app reopens it), or null */
const getMyCurrentRide = async (passengerId: string) => {
  const ride = await Ride.findOne({ passengerId, status: { $in: ACTIVE_RIDE } }).populate(POPULATE).lean<Populated>();
  return ride ? present(ride, "passenger") : null;
};

const cancelByPassenger = async (passengerId: string, id: string, reason?: string) => {
  const ride = Types.ObjectId.isValid(id) ? await Ride.findOne({ _id: id, passengerId }) : null;
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  if (ride.status === RideStatus.in_progress) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_STARTED");
  const cancelled = await Ride.findOneAndUpdate(
    { _id: ride._id, status: { $in: [RideStatus.searching, RideStatus.accepted, RideStatus.arrived] } },
    { $set: { status: RideStatus.cancelled, cancellation: { by: "passenger", reason, at: new Date() } } },
    { returnDocument: "after" },
  );
  if (!cancelled) throw new AppError(httpStatus.CONFLICT, "RIDE_CHANGED");
  const riderUser = cancelled.riderId ? (await RiderProfile.findById(cancelled.riderId).select("userId").lean())?.userId : undefined;
  if (riderUser) RideNotify.cancelledForRider(riderUser, cancelled, "passenger");
  RideNotify.changed(cancelled, [passengerId, riderUser]);
  await offerGone(cancelled._id, null);
  return getRide(passengerId, String(cancelled._id));
};

const rateRide = async (passengerId: string, id: string, payload: { stars: number; comment?: string }) => {
  const ride = Types.ObjectId.isValid(id) ? await Ride.findOne({ _id: id, passengerId }) : null;
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  if (ride.status !== RideStatus.completed) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_RATE_TOO_EARLY");
  const rated = await Ride.findOneAndUpdate(
    { _id: ride._id, "rating.stars": { $exists: false } },
    { $set: { rating: { stars: payload.stars, comment: payload.comment, at: new Date() } } },
    { returnDocument: "after" },
  );
  if (!rated) throw new AppError(httpStatus.CONFLICT, "RIDE_ALREADY_RATED");
  if (rated.riderId) {
    // Running average, one atomic update
    await RiderProfile.updateOne({ _id: rated.riderId }, [
      {
        $set: {
          "rideStats.ratingAvg": {
            $round: [
              {
                $divide: [
                  { $add: [{ $multiply: [{ $ifNull: ["$rideStats.ratingAvg", 0] }, { $ifNull: ["$rideStats.ratingCount", 0] }] }, payload.stars] },
                  { $add: [{ $ifNull: ["$rideStats.ratingCount", 0] }, 1] },
                ],
              },
              2,
            ],
          },
          "rideStats.ratingCount": { $add: [{ $ifNull: ["$rideStats.ratingCount", 0] }, 1] },
        },
      },
    ], { updatePipeline: true });
  }
  return getRide(passengerId, String(rated._id));
};

// ── Rider ───────────────────────────────────────────────────────────

const myRiderProfile = async (riderUserId: string) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId }).select(RIDER_FIELDS).lean<RiderLite>();
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "RIDER_PROFILE_NOT_FOUND");
  return rider;
};

/** Ride requests I can take now, nearest first (fare, pickup distance, trip) */
const getRideOffers = async (riderUserId: string) => {
  const rider = await myRiderProfile(riderUserId);
  await startRideTrialIfFirst(rider._id, await rideSettings());
  if ((await riderBlocker(rider)) || !rider.lastLocation?.coordinates) return [];
  const fresh = rider.lastLocationAt && Date.now() - rider.lastLocationAt.getTime() <= RIDE.locationFreshMinutes * MINUTE;
  if (!fresh) return [];
  const rides = await Ride.find({
    status: RideStatus.searching,
    offerSkippedBy: { $ne: rider._id },
    passengerId: { $ne: rider.userId },
  }).lean();
  const now = Date.now();
  return rides
    .map((ride) => ({ ride, km: round1(calculateDistanceKm(ride.pickup.location.coordinates, rider.lastLocation!.coordinates)) }))
    .filter(({ ride, km }) => km <= radiusAt(ride.searchStartedAt, now))
    .sort((a, b) => a.km - b.km)
    .map(({ ride, km }) => ({
      _id: ride._id,
      rideNumber: ride.rideNumber,
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      distanceKm: ride.distanceKm,
      durationMin: ride.durationMin,
      fare: ride.fare,
      note: ride.note,
      pickupKm: km,
      searchStartedAt: ride.searchStartedAt,
    }));
};

/** The first rider to accept takes the ride (atomic) */
const acceptRide = async (riderUserId: string, id: string) => {
  const rider = await myRiderProfile(riderUserId);
  await startRideTrialIfFirst(rider._id, await rideSettings());
  const blocker = await riderBlocker(rider);
  if (blocker) throw new AppError(httpStatus.BAD_REQUEST, blocker);
  const ride = Types.ObjectId.isValid(id) ? await Ride.findById(id).select("+offerSkippedBy") : null;
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  if (ride.status !== RideStatus.searching) throw new AppError(httpStatus.CONFLICT, "RIDE_ALREADY_TAKEN");
  if (String(ride.passengerId) === riderUserId) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_OWN");
  const coords = rider.lastLocation?.coordinates;
  const km = coords ? calculateDistanceKm(ride.pickup.location.coordinates, coords) : Infinity;
  if (km > radiusAt(ride.searchStartedAt) || (ride.offerSkippedBy ?? []).some((r) => String(r) === String(rider._id))) {
    throw new AppError(httpStatus.BAD_REQUEST, "RIDE_NOT_FOR_YOU");
  }
  const taken = await Ride.findOneAndUpdate(
    { _id: ride._id, status: RideStatus.searching },
    { $set: { status: RideStatus.accepted, riderId: rider._id, acceptedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!taken) throw new AppError(httpStatus.CONFLICT, "RIDE_ALREADY_TAKEN");
  const me = await User.findById(riderUserId).select("name").lean();
  RideNotify.accepted(taken.passengerId, taken, me?.name ?? "Rider");
  RideNotify.changed(taken, [taken.passengerId, riderUserId]);
  await offerGone(taken._id, rider._id);
  return getRide(riderUserId, String(taken._id));
};

/** My moto-taxi subscription: required or not, until when (starts the free period the first time) */
const getRiderAccess = async (riderUserId: string) => {
  const rider = await myRiderProfile(riderUserId);
  const rides = await rideSettings();
  const started = await startRideTrialIfFirst(rider._id, rides);
  const state = rideAccessState(started ? { rideAccessUntil: started, rideTrialUsedAt: new Date() } : rider, rides);
  return { ...state, trialDays: rides?.trialDays ?? 30, justStartedTrial: Boolean(started) };
};

const skipRide = async (riderUserId: string, id: string) => {
  const rider = await myRiderProfile(riderUserId);
  const result = Types.ObjectId.isValid(id) ? await Ride.updateOne({ _id: id }, { $addToSet: { offerSkippedBy: rider._id } }) : null;
  if (!result?.matchedCount) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  return { skipped: true };
};

const STEP: Record<"arrived" | "start" | "complete", { from: RideStatus; to: RideStatus; at: keyof IRide }> = {
  arrived: { from: RideStatus.accepted, to: RideStatus.arrived, at: "arrivedAt" },
  start: { from: RideStatus.arrived, to: RideStatus.in_progress, at: "startedAt" },
  complete: { from: RideStatus.in_progress, to: RideStatus.completed, at: "completedAt" },
};

/** The rider moves the ride on: arrived → start → complete */
const riderStep = async (riderUserId: string, id: string, step: keyof typeof STEP) => {
  const rider = await myRiderProfile(riderUserId);
  const { from, to, at } = STEP[step];
  const moved = Types.ObjectId.isValid(id)
    ? await Ride.findOneAndUpdate(
        { _id: id, riderId: rider._id, status: from },
        { $set: { status: to, [at]: new Date() } },
        { returnDocument: "after" },
      )
    : null;
  if (!moved) {
    const exists = Types.ObjectId.isValid(id) && (await Ride.exists({ _id: id, riderId: rider._id }));
    if (!exists) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
    throw new AppError(httpStatus.CONFLICT, "RIDE_CHANGED");
  }
  const me = await User.findById(riderUserId).select("name").lean();
  if (to === RideStatus.arrived) RideNotify.arrived(moved.passengerId, moved, me?.name ?? "Rider");
  if (to === RideStatus.completed) {
    await RiderProfile.updateOne({ _id: rider._id }, { $inc: { "rideStats.completed": 1 } });
    RideNotify.completed(moved.passengerId, moved);
  }
  RideNotify.changed(moved, [moved.passengerId, riderUserId]);
  return getRide(riderUserId, String(moved._id));
};

/** The rider drops a ride before it starts: it goes back to the other nearby riders */
const releaseByRider = async (riderUserId: string, id: string, reason?: string) => {
  const rider = await myRiderProfile(riderUserId);
  const released = Types.ObjectId.isValid(id)
    ? await Ride.findOneAndUpdate(
        { _id: id, riderId: rider._id, status: { $in: [RideStatus.accepted, RideStatus.arrived] } },
        {
          $set: { status: RideStatus.searching, searchStartedAt: new Date(), offerRadiusKm: RIDE.radiusSteps[0][1] },
          $unset: { riderId: 1, acceptedAt: 1, arrivedAt: 1 },
          $addToSet: { offerSkippedBy: rider._id },
        },
        { returnDocument: "after" },
      )
    : null;
  if (!released) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_DROP_TOO_LATE");
  logger.info("Rider dropped a ride", { rideId: String(released._id), riderId: String(rider._id), reason });
  RideNotify.riderLeft(released.passengerId, released);
  RideNotify.changed(released, [released.passengerId, riderUserId]);
  await announce(released._id);
  return { released: true };
};

/** My running ride as a rider, or null */
const getRiderCurrentRide = async (riderUserId: string) => {
  const rider = await myRiderProfile(riderUserId);
  const ride = await Ride.findOne({ riderId: rider._id, status: { $in: WITH_RIDER } }).populate(POPULATE).lean<Populated>();
  return ride ? present(ride, "rider") : null;
};

const getRiderRides = async (riderUserId: string, query: { page?: string; limit?: string }) => {
  const rider = await myRiderProfile(riderUserId);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const filter = { riderId: rider._id };
  const [rows, total] = await Promise.all([
    Ride.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<Populated[]>(),
    Ride.countDocuments(filter),
  ]);
  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, data: rows.map((r) => present(r, "rider")) };
};

// ── Dispatch ────────────────────────────────────────────────────────

/** Tells the riders newly in reach of a searching ride (each once) */
const announce = async (rideId: Types.ObjectId | string) => {
  const ride = await Ride.findOne({ _id: rideId, status: RideStatus.searching }).select("+offerNotified +offerSkippedBy");
  if (!ride) return;
  const now = Date.now();
  const radius = radiusAt(ride.searchStartedAt, now);
  const told = new Set([...(ride.offerNotified ?? []), ...(ride.offerSkippedBy ?? [])].map(String));
  const fresh = (await availableRiders(ride.pickup.location.coordinates, now)).filter(
    ({ rider, km }) => km <= radius && !told.has(String(rider._id)) && String(rider.userId) !== String(ride.passengerId),
  );
  await Ride.updateOne(
    { _id: ride._id },
    { $set: { offerRadiusKm: radius }, ...(fresh.length && { $addToSet: { offerNotified: { $each: fresh.map((r) => r.rider._id) } } }) },
  );
  for (const { rider, km } of fresh) RideNotify.offer(rider.userId, ride, km);
};

/** The request left the other riders' lists (taken or cancelled) */
const offerGone = async (rideId: Types.ObjectId, keep: Types.ObjectId | null) => {
  const ride = await Ride.findById(rideId).select("+offerNotified").lean();
  const others = (ride?.offerNotified ?? []).filter((r) => !keep || String(r) !== String(keep));
  if (!others.length) return;
  const users = await RiderProfile.find({ _id: { $in: others } }).select("userId").lean();
  for (const u of users) emitToUser(String(u.userId), "ride:offer_gone", { rideId });
};

const sweep = async () => {
  const now = Date.now();
  // Nobody took it in time
  const stale = await Ride.find({
    status: RideStatus.searching,
    searchStartedAt: { $lte: new Date(now - RIDE.searchMinutes * MINUTE) },
  }).select("_id");
  for (const { _id } of stale) {
    const ended = await Ride.findOneAndUpdate(
      { _id, status: RideStatus.searching },
      { $set: { status: RideStatus.expired } },
      { returnDocument: "after" },
    );
    if (!ended) continue;
    RideNotify.expired(ended.passengerId, ended);
    RideNotify.changed(ended, [ended.passengerId]);
    await offerGone(ended._id, null);
  }
  // Still searching: the radius grows, new riders may be in reach
  const searching = await Ride.find({ status: RideStatus.searching }).select("_id").lean();
  for (const { _id } of searching) await announce(_id);
};

const startRideSweep = () => {
  const run = () => sweep().catch((error) => logger.error("Ride sweep failed", { error: error instanceof Error ? error.message : error }));
  void run();
  const timer = setInterval(run, RIDE.sweepEveryMs);
  timer.unref();
  return timer;
};

/** Live position: forwarded to the passenger of the rider's running ride */
const forwardLocation = async (riderProfileId: Types.ObjectId, lat: number, lng: number, heading?: number) => {
  const ride = await Ride.findOne({ riderId: riderProfileId, status: { $in: WITH_RIDER } }).select("passengerId").lean();
  if (ride) emitToUser(String(ride.passengerId), "ride:location", { rideId: ride._id, lat, lng, heading });
};

// ── Admin ───────────────────────────────────────────────────────────

const getRidesForAdmin = async (query: { status?: string; search?: string; page?: string; limit?: string }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const filter: Record<string, unknown> = {};
  const status = Object.values(RideStatus).find((s) => s === query.status);
  if (status) filter.status = status;
  if (query.search?.trim()) {
    const rx = { $regex: escapeRegex(query.search.trim()), $options: "i" };
    const users = await User.find({ $or: [{ name: rx }, { phone: rx }] }).select("_id").limit(200).lean();
    const riders = await RiderProfile.find({ userId: { $in: users.map((u) => u._id) } }).select("_id").lean();
    filter.$or = [
      { rideNumber: rx },
      { "pickup.address": rx },
      { "dropoff.address": rx },
      { passengerId: { $in: users.map((u) => u._id) } },
      { riderId: { $in: riders.map((r) => r._id) } },
    ];
  }
  const [rows, total, counts, money] = await Promise.all([
    Ride.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<Populated[]>(),
    Ride.countDocuments(filter),
    Ride.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Ride.aggregate<{ fares: number; km: number }>([
      { $match: { status: RideStatus.completed } },
      { $group: { _id: null, fares: { $sum: "$fare" }, km: { $sum: "$distanceKm" } } },
    ]),
  ]);
  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
      completedFares: money[0]?.fares ?? 0,
      completedKm: round1(money[0]?.km ?? 0),
    },
    data: rows.map((r) => present(r, "admin")),
  };
};

const cancelByAdmin = async (adminUserId: string, id: string, reason: string) => {
  const cancelled = Types.ObjectId.isValid(id)
    ? await Ride.findOneAndUpdate(
        { _id: id, status: { $in: ACTIVE_RIDE } },
        { $set: { status: RideStatus.cancelled, cancellation: { by: "admin", reason, at: new Date() } } },
        { returnDocument: "after" },
      )
    : null;
  if (!cancelled) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_NOT_IN_PROGRESS");
  const riderUser = cancelled.riderId ? (await RiderProfile.findById(cancelled.riderId).select("userId").lean())?.userId : undefined;
  if (riderUser) RideNotify.cancelledForRider(riderUser, cancelled, "admin");
  RideNotify.cancelledForPassenger(cancelled.passengerId, cancelled);
  RideNotify.changed(cancelled, [cancelled.passengerId, riderUser]);
  await offerGone(cancelled._id, null);
  await AuditLogServices.record({ actorId: adminUserId, action: "ride.cancel", targetType: "ride", targetId: String(cancelled._id), after: { reason } });
  return getRide(adminUserId, String(cancelled._id), true);
};

export const RideServices = {
  estimate,
  requestRide,
  getRide,
  getMyRides,
  hideMyRide,
  getMyCurrentRide,
  cancelByPassenger,
  rateRide,
  getRideOffers,
  acceptRide,
  skipRide,
  riderStep,
  releaseByRider,
  getRiderCurrentRide,
  getRiderAccess,
  getRiderRides,
  sweep,
  startRideSweep,
  forwardLocation,
  getRidesForAdmin,
  cancelByAdmin,
};

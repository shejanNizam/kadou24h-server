/**
 * Negotiable moto-taxi price (client, 2026-11-21):
 * "The driver can increase the offered price up to 30%. Several drivers can send their price
 * at the same time, and the passenger chooses the offer that suits them best. The passenger
 * can also make a counter-offer." The percentage and the search distance are admin settings.
 *
 * - A rider answers a request with a price: Kadou24h's suggested fare, or more up to the
 *   ride's maxFare (suggested + settings.rides.maxRaisePercent, fixed at the request), in
 *   steps of 500 GNF. One live price at a time per rider, at most RIDE.maxBidsPerRider per ride.
 * - The passenger has RIDE.bidSeconds to answer: accept (the ride is theirs at that price),
 *   decline, or counter-offer once with a price between the suggested fare and the rider's.
 * - The rider has RIDE.counterSeconds to accept the counter-offer (the ride is theirs at that
 *   price) or decline it.
 * - Choosing a rider closes the other prices; the ride sweep expires unanswered ones.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { calculateDistanceKm } from "../delivery_rate/delivery_rate.service";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { startRideTrialIfFirst } from "../rider_profile/ride_access";
import { User } from "../user/user.model";
import { IRide, IRideBid, RideBidStatus, RideStatus } from "./ride.interface";
import { Ride } from "./ride.model";
import { RideNotify } from "./ride.notify";
import {
  LIVE_BID,
  myRiderProfile,
  offerGone,
  radiusAt,
  RIDE,
  RiderLite,
  riderBlocker,
  RideServices,
  rideSettings,
  searchCapKm,
} from "./ride.service";

const gnf = (amount: number) => `${amount.toLocaleString("fr-FR")} GNF`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const isLive = (b: IRideBid, now: number) => LIVE_BID.includes(b.status) && b.expiresAt.getTime() > now;
const limits = (ride: Pick<IRide, "fare" | "suggestedFare" | "maxFare">) => {
  const min = ride.suggestedFare ?? ride.fare;
  return { min, max: Math.max(min, ride.maxFare ?? min) };
};

const userName = async (userId: Types.ObjectId | string) => (await User.findById(userId).select("name").lean())?.name ?? "";
const riderUserOf = async (riderId: Types.ObjectId) => (await RiderProfile.findById(riderId).select("userId").lean())?.userId;

const findRide = async (id: string) => {
  const ride = Types.ObjectId.isValid(id) ? await Ride.findById(id).select("+offerSkippedBy") : null;
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  return ride;
};

const assertSearching = (ride: IRide) => {
  if (ride.status !== RideStatus.searching) throw new AppError(httpStatus.CONFLICT, "RIDE_ALREADY_TAKEN");
};

/** Whole GNF, a multiple of 500, within [min, max] */
const assertPrice = (price: number, min: number, max: number, code: "RIDE_BID_OUT_OF_RANGE" | "RIDE_COUNTER_OUT_OF_RANGE") => {
  if (price % RIDE.roundTo !== 0) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_BID_STEP", { step: gnf(RIDE.roundTo) });
  if (price < min || price > max) throw new AppError(httpStatus.BAD_REQUEST, code, { min: gnf(min), max: gnf(max) });
};

// ── Rider ───────────────────────────────────────────────────────────

/** I answer a request with a price (default: the suggested fare) */
const placeBid = async (riderUserId: string, id: string, payload: { price?: number }) => {
  const rider = await myRiderProfile(riderUserId);
  await startRideTrialIfFirst(rider._id, await rideSettings());
  const blocker = await riderBlocker(rider);
  if (blocker) throw new AppError(httpStatus.BAD_REQUEST, blocker);

  const ride = await findRide(id);
  assertSearching(ride);
  if (String(ride.passengerId) === riderUserId) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_OWN");
  const coords = rider.lastLocation?.coordinates;
  const km = coords ? calculateDistanceKm(ride.pickup.location.coordinates, coords) : Infinity;
  const skipped = (ride.offerSkippedBy ?? []).some((r) => String(r) === String(rider._id));
  if (skipped || km > radiusAt(ride.searchStartedAt, await searchCapKm())) {
    throw new AppError(httpStatus.BAD_REQUEST, "RIDE_NOT_FOR_YOU");
  }

  const { min, max } = limits(ride);
  const price = payload.price ?? min;
  assertPrice(price, min, max, "RIDE_BID_OUT_OF_RANGE");

  const now = new Date();
  const mine = (ride.bids ?? []).filter((b) => String(b.riderId) === String(rider._id));
  if (mine.some((b) => isLive(b, now.getTime()))) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_WAITING");
  if (mine.length >= RIDE.maxBidsPerRider) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_BID_LIMIT");
  // One live price at a time: two passengers could otherwise pick me at once
  const elsewhere = await Ride.exists({
    _id: { $ne: ride._id },
    status: RideStatus.searching,
    bids: { $elemMatch: { riderId: rider._id, status: { $in: LIVE_BID }, expiresAt: { $gt: now } } },
  });
  if (elsewhere) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_ELSEWHERE");

  const first = !(ride.bids ?? []).length;
  const updated = await Ride.findOneAndUpdate(
    {
      _id: ride._id,
      status: RideStatus.searching,
      bids: { $not: { $elemMatch: { riderId: rider._id, status: { $in: LIVE_BID }, expiresAt: { $gt: now } } } },
    },
    {
      $push: {
        bids: {
          riderId: rider._id,
          price,
          status: RideBidStatus.pending,
          pickupKm: round1(km),
          expiresAt: new Date(now.getTime() + RIDE.bidSeconds * 1000),
          createdAt: now,
        },
      },
      // Told about the ride: they hear when it is gone
      $addToSet: { offerNotified: rider._id },
    },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError(httpStatus.CONFLICT, "RIDE_ALREADY_TAKEN");

  RideNotify.bidReceived(updated.passengerId, updated, await userName(riderUserId), price, first);
  RideNotify.changed(updated, [riderUserId]);
  return { rideId: updated._id, price, expiresAt: updated.bids!.at(-1)!.expiresAt };
};

/** I take my waiting price back */
const withdrawBid = async (riderUserId: string, id: string) => {
  const rider = await myRiderProfile(riderUserId);
  const ride = Types.ObjectId.isValid(id)
    ? await Ride.findOneAndUpdate(
        { _id: id, status: RideStatus.searching },
        { $set: { "bids.$[b].status": RideBidStatus.withdrawn } },
        { arrayFilters: [{ "b.riderId": rider._id, "b.status": { $in: LIVE_BID } }], returnDocument: "after" },
      )
    : null;
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  RideNotify.changed(ride, [ride.passengerId, riderUserId]);
  return { withdrawn: true };
};

/** I answer the passenger's counter-offer: yes → the ride is mine at their price */
const answerCounter = async (riderUserId: string, id: string, accept: boolean) => {
  const rider = await myRiderProfile(riderUserId);
  const ride = await findRide(id);
  assertSearching(ride);
  const bid = (ride.bids ?? []).find(
    (b) => String(b.riderId) === String(rider._id) && b.status === RideBidStatus.countered && b.expiresAt.getTime() > Date.now(),
  );
  if (!bid?.counterPrice) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_GONE");

  if (!accept) {
    const declined = await Ride.findOneAndUpdate(
      { _id: ride._id, bids: { $elemMatch: { _id: bid._id, status: RideBidStatus.countered } } },
      { $set: { "bids.$.status": RideBidStatus.declined } },
      { returnDocument: "after" },
    );
    if (!declined) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_GONE");
    RideNotify.counterDeclined(declined.passengerId, declined, await userName(riderUserId));
    RideNotify.changed(declined, [declined.passengerId, riderUserId]);
    return RideServices.getRideOffers(riderUserId);
  }

  const blocker = await riderBlocker(rider);
  if (blocker) throw new AppError(httpStatus.BAD_REQUEST, blocker);
  const taken = await takeRide(ride._id, bid, [RideBidStatus.countered], bid.counterPrice);
  RideNotify.accepted(taken.passengerId, taken, await userName(riderUserId));
  RideNotify.changed(taken, [taken.passengerId, riderUserId]);
  await offerGone(taken._id, rider._id);
  return RideServices.getRide(riderUserId, String(taken._id));
};

// ── Passenger ───────────────────────────────────────────────────────

const myBid = async (passengerId: string, id: string, bidId: string) => {
  const ride = await findRide(id);
  if (String(ride.passengerId) !== passengerId) throw new AppError(httpStatus.NOT_FOUND, "RIDE_NOT_FOUND");
  assertSearching(ride);
  const bid = (ride.bids ?? []).find((b) => String(b._id) === bidId);
  if (!bid || !isLive(bid, Date.now())) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_GONE");
  return { ride, bid };
};

/** I choose this rider at their price (also after a counter-offer they haven't answered) */
const acceptBid = async (passengerId: string, id: string, bidId: string) => {
  const { ride, bid } = await myBid(passengerId, id, bidId);
  const rider = await RiderProfile.findById(bid.riderId)
    .select("userId lastLocation lastLocationAt activeDeliveryCount isOnline partnerType approvalStatus rideAccessUntil rideTrialUsedAt vehicle vestNumber")
    .lean<RiderLite>();
  // Went offline, took a delivery or another ride since: the price goes away
  if (!rider || (await riderBlocker(rider))) {
    await Ride.updateOne({ _id: ride._id, "bids._id": bid._id }, { $set: { "bids.$.status": RideBidStatus.withdrawn } });
    if (rider) RideNotify.changed(ride, [rider.userId]);
    throw new AppError(httpStatus.CONFLICT, "RIDE_RIDER_UNAVAILABLE");
  }
  const taken = await takeRide(ride._id, bid, LIVE_BID, bid.price);
  RideNotify.bidAccepted(rider.userId, taken);
  RideNotify.changed(taken, [passengerId, rider.userId]);
  await offerGone(taken._id, rider._id);
  return RideServices.getRide(passengerId, String(taken._id));
};

/** Not this one: the rider may send another price */
const declineBid = async (passengerId: string, id: string, bidId: string) => {
  const { ride, bid } = await myBid(passengerId, id, bidId);
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, bids: { $elemMatch: { _id: bid._id, status: { $in: LIVE_BID } } } },
    { $set: { "bids.$.status": RideBidStatus.declined } },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_GONE");
  RideNotify.changed(updated, [passengerId, await riderUserOf(bid.riderId)]);
  return RideServices.getRide(passengerId, String(updated._id));
};

/** I propose a lower price, once per rider's price: between the suggested fare and theirs */
const counterBid = async (passengerId: string, id: string, bidId: string, price: number) => {
  const { ride, bid } = await myBid(passengerId, id, bidId);
  if (bid.status !== RideBidStatus.pending) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_GONE");
  const { min } = limits(ride);
  if (bid.price - RIDE.roundTo < min) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_COUNTER_NOT_POSSIBLE");
  assertPrice(price, min, bid.price - RIDE.roundTo, "RIDE_COUNTER_OUT_OF_RANGE");
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, status: RideStatus.searching, bids: { $elemMatch: { _id: bid._id, status: RideBidStatus.pending } } },
    {
      $set: {
        "bids.$.status": RideBidStatus.countered,
        "bids.$.counterPrice": price,
        "bids.$.expiresAt": new Date(Date.now() + RIDE.counterSeconds * 1000),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_GONE");
  const riderUser = await riderUserOf(bid.riderId);
  if (riderUser) RideNotify.countered(riderUser, updated, price);
  RideNotify.changed(updated, [passengerId, riderUser]);
  return RideServices.getRide(passengerId, String(updated._id));
};

// ── Shared ──────────────────────────────────────────────────────────

/** The ride goes to this bid's rider at this price (atomic); the other prices close */
const takeRide = async (rideId: Types.ObjectId, bid: IRideBid, from: RideBidStatus[], price: number) => {
  const now = new Date();
  const taken = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      status: RideStatus.searching,
      bids: { $elemMatch: { _id: bid._id, status: { $in: from }, expiresAt: { $gt: now } } },
    },
    {
      $set: {
        status: RideStatus.accepted,
        riderId: bid.riderId,
        acceptedAt: now,
        fare: price,
        "bids.$[chosen].status": RideBidStatus.accepted,
        "bids.$[other].status": RideBidStatus.declined,
      },
    },
    {
      arrayFilters: [{ "chosen._id": bid._id }, { "other._id": { $ne: bid._id }, "other.status": { $in: LIVE_BID } }],
      returnDocument: "after",
    },
  );
  if (!taken) throw new AppError(httpStatus.CONFLICT, "RIDE_BID_GONE");
  return taken;
};

export const RideBidServices = {
  placeBid,
  withdrawBid,
  answerCounter,
  acceptBid,
  declineBid,
  counterBid,
};

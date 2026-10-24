/**
 * Moto-taxi subscription for riders (client, 2026-10-23): rides are free at first; later
 * Kadou24h switches on `settings.rides.subscriptionRequired` and riders pay a monthly
 * plan (audience moto_driver) to keep receiving passengers. Never a commission.
 *
 * While the switch is off nothing here blocks anyone. Once it is on, every rider gets
 * `trialDays` free once (started the first time they look for passengers), then needs a
 * plan. Kept free of service imports so payments, settings and rides can all use it.
 */
import { Types } from "mongoose";
import { RiderProfile } from "./rider_profile.model";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RideSubscriptionSettings {
  subscriptionRequired?: boolean;
  trialDays?: number;
}

/** Extra RiderProfile filter for riders who may get ride offers ({} while rides are free). */
export const rideAccessFilter = (rides: RideSubscriptionSettings | undefined, now = new Date()) =>
  rides?.subscriptionRequired
    ? // Paid or in trial — or never started the trial (it starts when they open their offers)
      { $or: [{ rideAccessUntil: { $gt: now } }, { rideTrialUsedAt: { $exists: false } }] }
    : {};

/** Starts the one-time free period if the subscription is required and it was never used. */
export const startRideTrialIfFirst = async (riderId: Types.ObjectId, rides: RideSubscriptionSettings | undefined) => {
  if (!rides?.subscriptionRequired) return null;
  const now = new Date();
  const rider = await RiderProfile.findOne({ _id: riderId, rideTrialUsedAt: { $exists: false } }).select("rideAccessUntil");
  if (!rider) return null;
  // Days already paid stay; the trial is added after them
  const from = rider.rideAccessUntil && rider.rideAccessUntil > now ? rider.rideAccessUntil : now;
  const until = new Date(from.getTime() + (rides.trialDays ?? 30) * DAY_MS);
  // Conditional: two requests at once start the trial only once
  const res = await RiderProfile.updateOne(
    { _id: riderId, rideTrialUsedAt: { $exists: false } },
    { $set: { rideTrialUsedAt: now, rideAccessUntil: until } },
  );
  return res.modifiedCount ? until : null;
};

/** A paid moto_driver plan: adds its days after what is left. */
export const extendRideAccess = async (userId: Types.ObjectId | string, days: number) => {
  const now = new Date();
  const profile = await RiderProfile.findOne({ userId }).select("rideAccessUntil rideTrialUsedAt");
  if (!profile) return null;
  const from = profile.rideAccessUntil && profile.rideAccessUntil > now ? profile.rideAccessUntil : now;
  profile.rideAccessUntil = new Date(from.getTime() + days * DAY_MS);
  // Paying uses up the trial: it is not added later on top
  profile.rideTrialUsedAt ??= now;
  await profile.save();
  return profile.rideAccessUntil;
};

/** What the rider app shows: can I take passengers, until when, is it the free period. */
export const rideAccessState = (
  rider: { rideAccessUntil?: Date; rideTrialUsedAt?: Date },
  rides: RideSubscriptionSettings | undefined,
  now = new Date(),
) => {
  if (!rides?.subscriptionRequired) return { required: false, allowed: true as boolean, until: null as Date | null, trialAvailable: false };
  const until = rider.rideAccessUntil ?? null;
  const trialAvailable = !rider.rideTrialUsedAt;
  return { required: true, allowed: trialAvailable || Boolean(until && until > now), until, trialAvailable };
};

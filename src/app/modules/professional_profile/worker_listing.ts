/**
 * Paid visibility for workers (client, 2026-10-22): a worker is shown to customers only
 * while `listedUntil` is in the future — a free trial after the first approval, then a
 * service-provider subscription. Kept free of service imports so payments, chat and
 * bookings can all use it.
 */
import { Types } from "mongoose";
import { BOOKING, DAY_MS } from "../booking/booking.constants";
import { ApprovalStatus } from "../profile_common/profile.common";
import { IProfessionalProfile } from "./professional_profile.interface";
import { ProfessionalProfile } from "./professional_profile.model";

/** Customers see (search, page, new chats, new bookings) only these workers. */
export const publicWorkerFilter = (now = new Date()) => ({
  isWorkerListed: true,
  approvalStatus: ApprovalStatus.approved,
  listedUntil: { $gt: now },
  // Suspended after repeated cancellations: hidden until the date passes
  "bookingPenalty.suspendedUntil": { $not: { $gt: now } },
});

export const isPublicWorker = (profile: Pick<IProfessionalProfile, "isWorkerListed" | "approvalStatus" | "listedUntil" | "bookingPenalty">, now = new Date()) =>
  profile.isWorkerListed &&
  profile.approvalStatus === ApprovalStatus.approved &&
  !!profile.listedUntil &&
  profile.listedUntil > now &&
  !(profile.bookingPenalty?.suspendedUntil && profile.bookingPenalty.suspendedUntil > now);

const later = (date: Date | undefined, now: Date) => (date && date > now ? date : now);

/** First approval ever: the free trial starts (once per profile). Call before save. */
export const startTrialIfFirst = (profile: IProfessionalProfile, now = new Date()) => {
  if (profile.trialUsedAt) return false;
  profile.trialUsedAt = now;
  profile.listedUntil = new Date(later(profile.listedUntil, now).getTime() + BOOKING.trialDays * DAY_MS);
  profile.listingNotice = {};
  return true;
};

/** A paid service-provider plan: adds its days after what is left (trial or earlier plan). */
export const extendWorkerListing = async (userId: Types.ObjectId | string, days: number) => {
  const now = new Date();
  const profile = await ProfessionalProfile.findOne({ userId });
  if (!profile) return null;
  profile.listedUntil = new Date(later(profile.listedUntil, now).getTime() + days * DAY_MS);
  // Paying also uses up the trial: it is not added later on top
  profile.trialUsedAt ??= now;
  profile.listingNotice = {};
  await profile.save();
  return profile.listedUntil;
};

/** Workers approved before subscriptions existed get the same free period. Idempotent. */
export const grantListingGrace = async () => {
  const now = new Date();
  const res = await ProfessionalProfile.updateMany(
    { approvalStatus: ApprovalStatus.approved, listedUntil: { $exists: false }, trialUsedAt: { $exists: false } },
    { $set: { listedUntil: new Date(now.getTime() + BOOKING.trialDays * DAY_MS), trialUsedAt: now } },
  );
  return res.modifiedCount;
};

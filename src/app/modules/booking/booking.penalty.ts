/**
 * Cancellation penalties (client, 2026-10-22), counted over the rolling last 30 days.
 * Only cancellations AFTER acceptance count; a decline, an expired request or a customer
 * cancelling before acceptance never do. Lifted strikes no longer count.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { escapeRegex } from "../../utils/queryParams";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { User } from "../user/user.model";
import { PENALTY } from "./booking.constants";
import { IBooking, IBookingPenalty, PenaltyType, StrikeRole } from "./booking.interface";
import { BookingStrike } from "./booking.model";
import { BookingNotify } from "./booking.notify";

const inMs = (ms: number, now: Date) => new Date(now.getTime() + ms);
const activeOnly = (now: Date) => ({ liftedAt: { $exists: false }, createdAt: { $gt: new Date(now.getTime() - PENALTY.windowMs) } });

/** The worker's current penalties (latest end date of each kind), saved on the profile for the search. */
const recomputeWorkerPenalty = async (userId: Types.ObjectId | string) => {
  const now = new Date();
  const strikes = await BookingStrike.find({
    userId,
    role: StrikeRole.worker,
    liftedAt: { $exists: false },
    $or: [{ lessVisibleUntil: { $gt: now } }, { suspendedUntil: { $gt: now } }, { limitedUntil: { $gt: now } }],
  }).lean();
  const latest = (key: keyof IBookingPenalty) =>
    strikes.reduce<Date | undefined>((max, s) => (s[key] && (!max || s[key]! > max) ? s[key] : max), undefined);
  const penalty: IBookingPenalty = {
    lessVisibleUntil: latest("lessVisibleUntil"),
    suspendedUntil: latest("suspendedUntil"),
    limitedUntil: latest("limitedUntil"),
  };
  await ProfessionalProfile.updateOne({ userId }, { $set: { bookingPenalty: penalty } });
  return penalty;
};

/** Customer: "one booking at a time" until this date, if limited */
const customerLimitedUntil = async (userId: Types.ObjectId | string, now = new Date()) => {
  const strike = await BookingStrike.findOne({
    userId,
    role: StrikeRole.customer,
    liftedAt: { $exists: false },
    limitedUntil: { $gt: now },
  })
    .sort({ limitedUntil: -1 })
    .select("limitedUntil")
    .lean();
  return strike?.limitedUntil;
};

/** A cancellation after acceptance → the next tier for whoever cancelled. Idempotent per booking. */
const addStrike = async (booking: Pick<IBooking, "_id" | "customerId" | "workerId">, role: StrikeRole) => {
  const now = new Date();
  const userId = role === StrikeRole.worker ? booking.workerId : booking.customerId;
  const prior = await BookingStrike.countDocuments({ userId, role, ...activeOnly(now) });
  const tier = prior + 1;

  let fields: { penalty: PenaltyType; lessVisibleUntil?: Date; suspendedUntil?: Date; limitedUntil?: Date };
  if (role === StrikeRole.worker) {
    fields =
      tier === 1
        ? { penalty: PenaltyType.warning }
        : tier === 2
          ? { penalty: PenaltyType.less_visible, lessVisibleUntil: inMs(PENALTY.lessVisibleMs, now) }
          : // 3rd and later: 7 days suspended, then one booking at a time until day 30
            { penalty: PenaltyType.suspension, suspendedUntil: inMs(PENALTY.suspensionMs, now), limitedUntil: inMs(PENALTY.limitedMs, now) };
  } else {
    fields = tier >= PENALTY.customerLimitFrom ? { penalty: PenaltyType.limited, limitedUntil: inMs(PENALTY.limitedMs, now) } : { penalty: PenaltyType.warning };
  }

  try {
    const strike = await BookingStrike.create({ userId, role, bookingId: booking._id, tier, ...fields });
    if (role === StrikeRole.worker) await recomputeWorkerPenalty(userId);
    BookingNotify.penalty(strike);
    return strike;
  } catch (error) {
    // Already counted for this booking
    if ((error as { code?: number }).code === 11000) return null;
    throw error;
  }
};

/** Shape the app shows right after a cancellation (and in the worker / customer screens). */
const presentStrike = (strike: { tier: number; penalty: PenaltyType; lessVisibleUntil?: Date; suspendedUntil?: Date; limitedUntil?: Date; role: StrikeRole }) => ({
  role: strike.role,
  tier: strike.tier,
  penalty: strike.penalty,
  lessVisibleUntil: strike.lessVisibleUntil,
  suspendedUntil: strike.suspendedUntil,
  limitedUntil: strike.limitedUntil,
});

/** Customer side of the booking rules, for the booking form */
const getMyStanding = async (userId: string) => {
  const now = new Date();
  const [strikes, limitedUntil] = await Promise.all([
    BookingStrike.countDocuments({ userId, role: StrikeRole.customer, ...activeOnly(now) }),
    customerLimitedUntil(userId, now),
  ]);
  return { customer: { strikes30d: strikes, limitedUntil } };
};

// ── Admin ───────────────────────────────────────────────────────────

const listStrikes = async (query: { role?: string; active?: string; search?: string; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const now = new Date();
  const filter: Record<string, unknown> = {};
  const role = Object.values(StrikeRole).find((r) => r === query.role);
  if (role) filter.role = role;
  // "active": penalty still running or counted in the last 30 days
  if (query.active === "true") Object.assign(filter, activeOnly(now));
  if (query.search?.trim()) {
    const rx = { $regex: escapeRegex(query.search.trim()), $options: "i" };
    const users = await User.find({ $or: [{ name: rx }, { phone: rx }] }).select("_id").limit(200).lean();
    filter.userId = { $in: users.map((u) => u._id) };
  }
  const [data, total] = await Promise.all([
    BookingStrike.find(filter)
      .populate("userId", "name phone avatar")
      .populate("bookingId", "bookingNumber scheduledAt cancelReason cancelledAt")
      .populate("liftedBy", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BookingStrike.countDocuments(filter),
  ]);
  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, data };
};

/**
 * lift: the strike no longer counts and its penalty stops.
 * soften: a worker's suspension becomes 30 days of reduced visibility (the client's alternative).
 */
const changeStrike = async (id: string, payload: { action: "lift" | "soften"; note?: string }, actorId: string) => {
  const strike = await BookingStrike.findById(id);
  if (!strike) throw new AppError(httpStatus.NOT_FOUND, "PENALTY_NOT_FOUND");
  if (strike.liftedAt) throw new AppError(httpStatus.BAD_REQUEST, "PENALTY_ALREADY_LIFTED");
  const before = { penalty: strike.penalty, suspendedUntil: strike.suspendedUntil, limitedUntil: strike.limitedUntil, lessVisibleUntil: strike.lessVisibleUntil };
  const now = new Date();

  if (payload.action === "soften") {
    if (strike.role !== StrikeRole.worker || strike.penalty !== PenaltyType.suspension) {
      throw new AppError(httpStatus.BAD_REQUEST, "PENALTY_SOFTEN_ONLY_SUSPENSION");
    }
    strike.penalty = PenaltyType.less_visible;
    strike.set("suspendedUntil", undefined);
    strike.set("limitedUntil", undefined);
    strike.lessVisibleUntil = inMs(PENALTY.softenedLessVisibleMs, strike.createdAt ?? now);
    strike.softenedAt = now;
  } else {
    strike.liftedAt = now;
    strike.liftedBy = new Types.ObjectId(actorId);
  }
  if (payload.note) strike.adminNote = payload.note;
  await strike.save();
  if (strike.role === StrikeRole.worker) await recomputeWorkerPenalty(strike.userId);
  BookingNotify.penaltyChanged(strike.userId, payload.action, strike.lessVisibleUntil);

  await AuditLogServices.record({
    actorId,
    action: `booking_penalty.${payload.action}`,
    targetType: "booking_strike",
    targetId: id,
    before,
    after: { penalty: strike.penalty, liftedAt: strike.liftedAt, lessVisibleUntil: strike.lessVisibleUntil, note: payload.note },
  });
  return strike;
};

export const BookingPenalty = {
  addStrike,
  presentStrike,
  recomputeWorkerPenalty,
  customerLimitedUntil,
  getMyStanding,
  listStrikes,
  changeStrike,
};

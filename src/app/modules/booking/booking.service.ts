/**
 * Worker bookings (client, 2026-10-22). Payments are made directly between the customer
 * and the worker (cash / Orange Money), never through the app: no escrow, no commission.
 * Contact details (phones, full address) are shared only once the worker accepted.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { fromGeoPoint } from "../../utils/commonSchemas";
import { logger } from "../../utils/logger";
import { escapeRegex } from "../../utils/queryParams";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { CounterServices } from "../counter/counter.service";
import { IAddressSnapshot } from "../order/order.interface";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { publicWorkerFilter } from "../professional_profile/worker_listing";
import { ApprovalStatus } from "../profile_common/profile.common";
import { User } from "../user/user.model";
import { BOOKING } from "./booking.constants";
import { BookingActor, BookingStatus, CONTACT_STATUSES, IBooking, OPEN_STATUSES, StrikeRole } from "./booking.interface";
import { Booking, BookingStrike, WorkerReview } from "./booking.model";
import { BookingNotify } from "./booking.notify";
import { BookingPenalty } from "./booking.penalty";
import { IFileRef } from "../../interfaces/common.types";

/** Requests and accepted jobs: what "one booking at a time" counts */
const ACTIVE = [BookingStatus.requested, BookingStatus.accepted];
const HISTORY = [BookingStatus.declined, BookingStatus.expired, BookingStatus.cancelled, BookingStatus.completed];

const fmtDay = (date: Date) => date.toLocaleDateString("en-GB", { timeZone: "Africa/Conakry", day: "numeric", month: "long" });

const step = (status: BookingStatus, by: BookingActor, note?: string) => ({ status, by, at: new Date(), ...(note ? { note } : {}) });

// ── Views ───────────────────────────────────────────────────────────

interface Person { _id: Types.ObjectId; name?: string; avatar?: unknown; phone?: string }
type Populated = Omit<IBooking, "customerId" | "workerId" | "workerProfileId"> & {
  customerId: Person;
  workerId: Person;
  workerProfileId: { _id: Types.ObjectId; profession?: string; photo?: IFileRef; ratingAvg?: number; ratingCount?: number } | null;
};

const POPULATE = [
  { path: "customerId", select: "name avatar phone" },
  { path: "workerId", select: "name avatar phone" },
  { path: "workerProfileId", select: "profession photo ratingAvg ratingCount" },
];

/** Before acceptance the worker sees the area only; phones only while the job is on. */
const present = (b: Populated, viewerId: string, admin = false) => {
  const role: "customer" | "worker" | "admin" = admin ? "admin" : String(b.customerId?._id) === viewerId ? "customer" : "worker";
  const contact = admin || CONTACT_STATUSES.includes(b.status);
  const person = (p: Person | null, withPhone: boolean) =>
    p ? { _id: p._id, name: p.name, avatar: p.avatar, ...(withPhone && p.phone ? { phone: p.phone } : {}) } : null;
  const a = b.address as IAddressSnapshot;
  const fullAddress = role === "customer" || contact;
  return {
    _id: b._id,
    bookingNumber: b.bookingNumber,
    role,
    status: b.status,
    scheduledAt: b.scheduledAt,
    description: b.description,
    photos: b.photos ?? [],
    profession: b.profession,
    hourlyRate: b.hourlyRate,
    customer: person(b.customerId, contact && role !== "customer"),
    worker: b.workerProfileId
      ? { ...person(b.workerId, contact && role !== "worker"), profileId: b.workerProfileId._id, profession: b.workerProfileId.profession, photo: b.workerProfileId.photo, ratingAvg: b.workerProfileId.ratingAvg, ratingCount: b.workerProfileId.ratingCount }
      : person(b.workerId, contact && role !== "worker"),
    address: fullAddress
      ? {
          fullName: a.fullName,
          phone: role === "customer" || contact ? a.phone : undefined,
          city: a.city,
          commune: a.commune,
          neighborhood: a.neighborhood,
          landmark: a.landmark,
          directions: a.directions,
          location: fromGeoPoint(a.location),
          placePhoto: a.placePhoto,
        }
      : { city: a.city, commune: a.commune, neighborhood: a.neighborhood },
    contactShared: contact,
    respondBy: b.respondBy,
    acceptedAt: b.acceptedAt,
    declinedAt: b.declinedAt,
    declineReason: b.declineReason,
    expiredAt: b.expiredAt,
    cancelledAt: b.cancelledAt,
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    cancelCounted: b.cancelCounted,
    doneAt: b.doneAt,
    agreedPrice: b.agreedPrice,
    confirmBy: b.confirmBy,
    completedAt: b.completedAt,
    completedBy: b.completedBy,
    reviewId: b.reviewId,
    canReview: role === "customer" && b.status === BookingStatus.completed && !b.reviewId,
    history: b.history,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
};

const load = async (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new AppError(httpStatus.NOT_FOUND, "Booking not found");
  const booking = await Booking.findById(id).populate(POPULATE).lean<Populated>();
  if (!booking) throw new AppError(httpStatus.NOT_FOUND, "Booking not found");
  return booking;
};

const view = async (id: string, viewerId: string) => present(await load(id), viewerId);

/** The booking, only for its customer or worker */
const getMyBooking = async (userId: string, id: string) => {
  const booking = await load(id);
  if (String(booking.customerId?._id) !== userId && String(booking.workerId?._id) !== userId) {
    throw new AppError(httpStatus.NOT_FOUND, "Booking not found");
  }
  const result = present(booking, userId);
  const review = booking.reviewId ? await WorkerReview.findById(booking.reviewId).select("rating comment photos status createdAt").lean() : null;
  return { ...result, review };
};

const getMyBookings = async (
  userId: string,
  query: { as?: string; status?: string; page?: number; limit?: number },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const as = query.as === "worker" ? "worker" : "customer";
  const me = new Types.ObjectId(userId);
  const base = as === "worker" ? { workerId: me } : { customerId: me };

  const filter: Record<string, unknown> = { ...base };
  const single = Object.values(BookingStatus).find((s) => s === query.status);
  if (single) filter.status = single;
  else if (query.status === "history") filter.status = { $in: HISTORY };
  else if (query.status === "active" || !query.status) filter.status = { $in: OPEN_STATUSES };

  // Open: soonest first (requests by answer deadline); history: latest first
  const historyLike = query.status === "history" || HISTORY.includes(single as BookingStatus);
  const sort: Record<string, 1 | -1> = single === BookingStatus.requested ? { respondBy: 1 } : historyLike ? { updatedAt: -1 } : { scheduledAt: 1 };

  const [rows, total, counts] = await Promise.all([
    Booking.find(filter).populate(POPULATE).sort(sort).skip((page - 1) * limit).limit(limit).lean<Populated[]>(),
    Booking.countDocuments(filter),
    Booking.aggregate<{ _id: BookingStatus; n: number }>([{ $match: base }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) },
    data: rows.map((b) => present(b, userId)),
  };
};

// ── Customer: request ───────────────────────────────────────────────

const savedAddress = async (userId: string, addressId?: string): Promise<IAddressSnapshot> => {
  const user = await User.findById(userId).select("addresses");
  const address = addressId
    ? user?.addresses?.find((a) => String(a._id) === String(addressId))
    : user?.addresses?.find((a) => a.isDefault) ?? user?.addresses?.[0];
  if (!address?.location) {
    throw new AppError(httpStatus.BAD_REQUEST, "Please choose the address where the work will be done");
  }
  return {
    fullName: address.fullName,
    phone: address.phone,
    city: address.city,
    commune: address.commune,
    neighborhood: address.neighborhood,
    landmark: address.landmark,
    directions: address.directions,
    location: address.location,
    placePhoto: address.placePhoto,
  };
};

const createBooking = async (
  customerId: string,
  payload: { workerProfileId: string; scheduledAt: string | Date; addressId?: string; description: string; photos?: IFileRef[] },
) => {
  const now = new Date();
  const profile = await ProfessionalProfile.findOne({ _id: payload.workerProfileId, ...publicWorkerFilter(now) }).select(
    "userId profession hourlyRate serviceCategoryId",
  );
  if (!profile) throw new AppError(httpStatus.NOT_FOUND, "This worker is not available for bookings");
  if (String(profile.userId) === customerId) throw new AppError(httpStatus.BAD_REQUEST, "You cannot book yourself");

  const scheduledAt = new Date(payload.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() + BOOKING.minLeadMs) {
    throw new AppError(httpStatus.BAD_REQUEST, "Choose a date and time at least 30 minutes from now");
  }
  if (scheduledAt.getTime() > now.getTime() + BOOKING.maxAheadMs) {
    throw new AppError(httpStatus.BAD_REQUEST, "You can book up to 60 days ahead");
  }

  const me = new Types.ObjectId(customerId);
  const [sameWorker, openRequests, activeCount, limitedUntil] = await Promise.all([
    Booking.exists({ customerId: me, workerProfileId: profile._id, status: { $in: OPEN_STATUSES } }),
    Booking.countDocuments({ customerId: me, status: BookingStatus.requested }),
    Booking.countDocuments({ customerId: me, status: { $in: ACTIVE } }),
    BookingPenalty.customerLimitedUntil(me, now),
  ]);
  if (limitedUntil && activeCount > 0) {
    throw new AppError(httpStatus.BAD_REQUEST, `Your bookings are limited to one at a time until ${fmtDay(limitedUntil)}`);
  }
  if (sameWorker) throw new AppError(httpStatus.CONFLICT, "You already have an open booking with this worker");
  if (openRequests >= BOOKING.maxOpenRequests) {
    throw new AppError(httpStatus.BAD_REQUEST, `You can have up to ${BOOKING.maxOpenRequests} requests waiting for an answer`);
  }

  const address = await savedAddress(customerId, payload.addressId);
  const respondBy = new Date(Math.min(now.getTime() + BOOKING.respondMs, scheduledAt.getTime()));
  const booking = await Booking.create({
    bookingNumber: await CounterServices.nextCode("booking"),
    customerId: me,
    workerId: profile.userId,
    workerProfileId: profile._id,
    profession: profile.profession,
    hourlyRate: profile.hourlyRate,
    serviceCategoryId: profile.serviceCategoryId,
    scheduledAt,
    address,
    description: payload.description,
    photos: payload.photos ?? [],
    status: BookingStatus.requested,
    respondBy,
    history: [step(BookingStatus.requested, "customer")],
  });

  const customer = await User.findById(me).select("name").lean();
  BookingNotify.requested(booking, customer?.name ?? "Un client");
  return view(String(booking._id), customerId);
};

// ── Status changes ──────────────────────────────────────────────────

/**
 * Moves a booking from one of `from` to a new status — atomically, so two taps or
 * the sweep racing a person can never both win.
 */
const transition = async (
  id: string,
  who: { field: "customerId" | "workerId"; userId: string } | null,
  from: BookingStatus[],
  set: Record<string, unknown>,
  entry: ReturnType<typeof step>,
  unset: string[] = [],
) => {
  const match: Record<string, unknown> = { _id: id, status: { $in: from } };
  if (who) match[who.field] = new Types.ObjectId(who.userId);
  return Booking.findOneAndUpdate(
    match,
    { $set: { ...set, status: entry.status }, $push: { history: entry }, ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, 1])) } : {}) },
    { returnDocument: "after" },
  );
};

/** Why an action failed: not yours / wrong status */
const explain = async (id: string, userId: string, field: "customerId" | "workerId", what: string) => {
  const b = Types.ObjectId.isValid(id) ? await Booking.findById(id).select("customerId workerId status").lean() : null;
  if (!b || String(b[field]) !== userId) throw new AppError(httpStatus.NOT_FOUND, "Booking not found");
  throw new AppError(httpStatus.BAD_REQUEST, `This booking is ${b.status}: you can't ${what} it`);
};

const nameOf = async (userId: Types.ObjectId) => (await User.findById(userId).select("name").lean())?.name ?? "";

const accept = async (workerId: string, id: string) => {
  const now = new Date();
  // Only the booking's worker, and only a waiting request
  const booking = Types.ObjectId.isValid(id) ? await Booking.findOne({ _id: id, workerId, status: BookingStatus.requested }).select("respondBy") : null;
  if (!booking) return explain(id, workerId, "workerId", "accept");
  const profile = await ProfessionalProfile.findOne({ userId: workerId }).select("approvalStatus bookingPenalty");
  if (!profile || profile.approvalStatus !== ApprovalStatus.approved) {
    throw new AppError(httpStatus.FORBIDDEN, "Your worker profile is not approved");
  }
  const penalty = profile.bookingPenalty;
  if (penalty?.suspendedUntil && penalty.suspendedUntil > now) {
    throw new AppError(httpStatus.FORBIDDEN, `Your bookings are suspended until ${fmtDay(penalty.suspendedUntil)}`);
  }
  if (penalty?.limitedUntil && penalty.limitedUntil > now) {
    const busy = await Booking.exists({ workerId, status: { $in: [BookingStatus.accepted, BookingStatus.done] }, _id: { $ne: id } });
    if (busy) throw new AppError(httpStatus.BAD_REQUEST, `You can only have one booking at a time until ${fmtDay(penalty.limitedUntil)}`);
  }

  if (booking.respondBy <= now) {
    await expireOne(id);
    throw new AppError(httpStatus.BAD_REQUEST, "This request has expired");
  }
  const updated = await transition(id, { field: "workerId", userId: workerId }, [BookingStatus.requested], { acceptedAt: now }, step(BookingStatus.accepted, "worker"));
  if (!updated) return explain(id, workerId, "workerId", "accept");
  BookingNotify.accepted(updated, await nameOf(updated.workerId));
  return view(id, workerId);
};

const decline = async (workerId: string, id: string, reason?: string) => {
  const updated = await transition(
    id,
    { field: "workerId", userId: workerId },
    [BookingStatus.requested],
    { declinedAt: new Date(), ...(reason ? { declineReason: reason } : {}) },
    step(BookingStatus.declined, "worker", reason),
  );
  if (!updated) return explain(id, workerId, "workerId", "decline");
  BookingNotify.declined(updated, await nameOf(updated.workerId));
  return view(id, workerId);
};

/**
 * Either person cancels. Before acceptance (customer) it is free; after acceptance it
 * counts toward the penalties and needs a reason. A worker "cancelling" a request declines it.
 */
const cancel = async (userId: string, id: string, reason?: string) => {
  const current = Types.ObjectId.isValid(id) ? await Booking.findById(id).select("customerId workerId status") : null;
  if (!current) throw new AppError(httpStatus.NOT_FOUND, "Booking not found");
  const isCustomer = String(current.customerId) === userId;
  const isWorker = String(current.workerId) === userId;
  if (!isCustomer && !isWorker) throw new AppError(httpStatus.NOT_FOUND, "Booking not found");

  if (isWorker && current.status === BookingStatus.requested) {
    return { booking: await decline(userId, id, reason), penalty: null };
  }
  if (current.status === BookingStatus.done) {
    throw new AppError(httpStatus.BAD_REQUEST, "The job is marked as done: confirm it or say it is not finished");
  }
  const counted = current.status === BookingStatus.accepted;
  if (counted && (reason?.trim().length ?? 0) < 3) {
    throw new AppError(httpStatus.BAD_REQUEST, "Please give the reason for cancelling");
  }
  const by = isCustomer ? "customer" : "worker";
  const from = isCustomer ? [BookingStatus.requested, BookingStatus.accepted] : [BookingStatus.accepted];
  if (!from.includes(current.status)) {
    throw new AppError(httpStatus.BAD_REQUEST, `This booking is ${current.status}: you can't cancel it`);
  }
  const updated = await transition(
    id,
    { field: isCustomer ? "customerId" : "workerId", userId },
    // The status read above: if it changed meanwhile (accepted, expired…) the user must look again
    from.filter((s) => s === current.status),
    { cancelledAt: new Date(), cancelledBy: by, cancelCounted: counted, ...(reason ? { cancelReason: reason } : {}) },
    step(BookingStatus.cancelled, by, reason),
  );
  if (!updated) {
    throw new AppError(httpStatus.CONFLICT, "This booking has just changed. Please refresh");
  }
  BookingNotify.cancelled(updated, by, reason);
  const strike = counted ? await BookingPenalty.addStrike(updated, isCustomer ? StrikeRole.customer : StrikeRole.worker) : null;
  return { booking: await view(id, userId), penalty: strike ? BookingPenalty.presentStrike(strike) : null };
};

/** The worker finished: the customer confirms within 48 h (else automatic). */
const markDone = async (workerId: string, id: string, payload: { agreedPrice?: number }) => {
  const now = new Date();
  const updated = await transition(
    id,
    { field: "workerId", userId: workerId },
    [BookingStatus.accepted],
    { doneAt: now, confirmBy: new Date(now.getTime() + BOOKING.confirmMs), ...(payload.agreedPrice !== undefined ? { agreedPrice: payload.agreedPrice } : {}) },
    step(BookingStatus.done, "worker"),
  );
  if (!updated) return explain(id, workerId, "workerId", "finish");
  BookingNotify.done(updated, await nameOf(updated.workerId));
  return view(id, workerId);
};

const confirmDone = async (customerId: string, id: string) => {
  const updated = await transition(
    id,
    { field: "customerId", userId: customerId },
    [BookingStatus.done],
    { completedAt: new Date(), completedBy: "customer" },
    step(BookingStatus.completed, "customer"),
  );
  if (!updated) return explain(id, customerId, "customerId", "confirm");
  BookingNotify.completed(updated, false);
  return view(id, customerId);
};

/** "Not finished yet": back to accepted, the worker is told why. */
const reportNotDone = async (customerId: string, id: string, note?: string) => {
  const updated = await transition(
    id,
    { field: "customerId", userId: customerId },
    [BookingStatus.done],
    {},
    { ...step(BookingStatus.accepted, "customer", note) },
    ["doneAt", "confirmBy"],
  );
  if (!updated) return explain(id, customerId, "customerId", "reopen");
  BookingNotify.notDone(updated, note);
  return view(id, customerId);
};

// ── Sweep: unanswered requests, unconfirmed jobs, visibility notices ──

const expireOne = async (id: string | Types.ObjectId) => {
  const updated = await Booking.findOneAndUpdate(
    { _id: id, status: BookingStatus.requested, respondBy: { $lte: new Date() } },
    { $set: { status: BookingStatus.expired, expiredAt: new Date() }, $push: { history: step(BookingStatus.expired, "system") } },
    { returnDocument: "after" },
  );
  if (updated) BookingNotify.expired(updated);
  return updated;
};

const sweep = async () => {
  const now = new Date();
  const toExpire = await Booking.find({ status: BookingStatus.requested, respondBy: { $lte: now } }).select("_id").limit(200).lean();
  for (const b of toExpire) await expireOne(b._id);

  const toComplete = await Booking.find({ status: BookingStatus.done, confirmBy: { $lte: now } }).select("_id").limit(200).lean();
  for (const b of toComplete) {
    const updated = await Booking.findOneAndUpdate(
      { _id: b._id, status: BookingStatus.done, confirmBy: { $lte: now } },
      { $set: { status: BookingStatus.completed, completedAt: now, completedBy: "system" }, $push: { history: step(BookingStatus.completed, "system") } },
      { returnDocument: "after" },
    );
    if (updated) BookingNotify.completed(updated, true);
  }

  // Visibility: "ends in 3 days", then "ended" (once per end date)
  const soon = await ProfessionalProfile.find({
    approvalStatus: ApprovalStatus.approved,
    isWorkerListed: true,
    listedUntil: { $gt: now, $lte: new Date(now.getTime() + BOOKING.listingReminderDays * 86_400_000) },
    $expr: { $ne: [{ $ifNull: ["$listingNotice.soonFor", null] }, "$listedUntil"] },
  })
    .select("userId listedUntil")
    .limit(100);
  for (const p of soon) {
    await ProfessionalProfile.updateOne({ _id: p._id }, { $set: { "listingNotice.soonFor": p.listedUntil } });
    BookingNotify.listing(p.userId, p.listedUntil!, false);
  }
  const ended = await ProfessionalProfile.find({
    approvalStatus: ApprovalStatus.approved,
    isWorkerListed: true,
    listedUntil: { $lte: now, $gt: new Date(now.getTime() - 7 * 86_400_000) },
    $expr: { $ne: [{ $ifNull: ["$listingNotice.endedFor", null] }, "$listedUntil"] },
  })
    .select("userId listedUntil")
    .limit(100);
  for (const p of ended) {
    await ProfessionalProfile.updateOne({ _id: p._id }, { $set: { "listingNotice.endedFor": p.listedUntil } });
    BookingNotify.listing(p.userId, p.listedUntil!, true);
  }
  return { expired: toExpire.length, completed: toComplete.length, listingSoon: soon.length, listingEnded: ended.length };
};

const startBookingSweep = () => {
  const run = () =>
    sweep().catch((error) => logger.error("Booking sweep failed", { error: error instanceof Error ? error.message : error }));
  void run();
  const timer = setInterval(run, BOOKING.sweepEveryMs);
  timer.unref();
  return timer;
};

// ── Admin ───────────────────────────────────────────────────────────

const getBookingsForAdmin = async (query: { status?: string; search?: string; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const filter: Record<string, unknown> = {};
  const status = Object.values(BookingStatus).find((s) => s === query.status);
  if (status) filter.status = status;
  if (query.search?.trim()) {
    const rx = { $regex: escapeRegex(query.search.trim()), $options: "i" };
    const users = await User.find({ $or: [{ name: rx }, { phone: rx }] }).select("_id").limit(200).lean();
    const ids = users.map((u) => u._id);
    filter.$or = [{ bookingNumber: rx }, { profession: rx }, { customerId: { $in: ids } }, { workerId: { $in: ids } }];
  }
  const [rows, total, counts] = await Promise.all([
    Booking.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<Populated[]>(),
    Booking.countDocuments(filter),
    Booking.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) },
    data: rows.map((b) => present(b, "", true)),
  };
};

const getBookingForAdmin = async (id: string) => {
  const booking = await load(id);
  const [review, strikes] = await Promise.all([
    booking.reviewId ? WorkerReview.findById(booking.reviewId).lean() : null,
    BookingStrike.find({ bookingId: booking._id }).populate("userId", "name").lean(),
  ]);
  return { ...present(booking, "", true), review, strikes };
};

/** The team cancels (dispute, safety…): never counts as a strike. */
const cancelByAdmin = async (id: string, reason: string, actorId: string) => {
  const updated = await transition(
    id,
    null,
    [BookingStatus.requested, BookingStatus.accepted, BookingStatus.done],
    { cancelledAt: new Date(), cancelledBy: "admin", cancelCounted: false, cancelReason: reason },
    step(BookingStatus.cancelled, "admin", reason),
  );
  if (!updated) throw new AppError(httpStatus.BAD_REQUEST, "Only an open booking can be cancelled");
  BookingNotify.cancelled(updated, "admin", reason);
  await AuditLogServices.record({ actorId, action: "booking.cancel", targetType: "booking", targetId: id, after: { reason } });
  return getBookingForAdmin(id);
};

export const BookingServices = {
  createBooking,
  getMyBookings,
  getMyBooking,
  accept,
  decline,
  cancel,
  markDone,
  confirmDone,
  reportNotDone,
  sweep,
  startBookingSweep,
  getBookingsForAdmin,
  getBookingForAdmin,
  cancelByAdmin,
};

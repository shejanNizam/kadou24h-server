/**
 * Open dispatch (client, 2026-10-23): a delivery leg is offered to the riders
 * near its pickup point, the nearest first, and the radius grows every minute.
 * Each rider sees the distance and what they earn; the first to accept takes it.
 * The store may still send a leg to one rider, who has a few minutes to answer
 * before it goes back to everyone, so nothing gets stuck. The customer never
 * chooses the rider.
 *
 * When a leg opens: the first leg once the store accepts the order; a later
 * leg (station → station / customer) once the parcel is picked up on the leg
 * before it — its rider must be there for the station handover.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import type { ErrorCode } from "../../i18n/errors";
import type { MessageParams } from "../../i18n/translate";
import { emitToDelivery, emitToUser } from "../../../socket/socket";
import { logger } from "../../utils/logger";
import { calculateDistanceKm } from "../delivery_rate/delivery_rate.service";
import { Notify } from "../notification/notification.events";
import { Notification } from "../notification/notification.model";
import { SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { ApprovalStatus } from "../profile_common/profile.common";
import { PartnerType } from "../rider_profile/rider_profile.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { ADMIN_ROLES, UserStatus } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { LinkStatus } from "../vendor_rider_link/vendor_rider_link.interface";
import { VendorRiderLink } from "../vendor_rider_link/vendor_rider_link.model";
import { WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import { Ride } from "../ride/ride.model";
import { ACTIVE_RIDE } from "../ride/ride.service";
import { DeliveryStatus, EndpointKind, IDelivery, LegType } from "./delivery.interface";
import { Delivery } from "./delivery.model";

export const DISPATCH = {
  // The e2e run speeds it up (DISPATCH_SWEEP_MS)
  sweepEveryMs: Number(process.env.DISPATCH_SWEEP_MS) || 30_000,
  /** A rider chosen by the store has this long to accept */
  reserveMinutes: 10,
  /** [minutes since the offer opened, radius in km] */
  radiusSteps: [
    [0, 3],
    [1, 5],
    [2, 8],
    [5, 15],
  ] as const,
  maxRadiusKm: 15,
  /** A position older than this does not count (the rider may have moved) */
  locationFreshMinutes: 30,
  /** Moto riders carry at most this many parcels at once (bus drivers: no limit) */
  maxActiveMoto: 3,
  /** Nobody took it after… → the store and the Kadou24h team are told */
  alertAfterMinutes: { store: 10, station: 60 },
} as const;

const MINUTE = 60_000;
const OPEN_SUB_ORDER = [SubOrderStatus.accepted, SubOrderStatus.preparing, SubOrderStatus.ready_for_pickup, SubOrderStatus.in_delivery];
const MOVING_LEG = [DeliveryStatus.picked_up, DeliveryStatus.in_transit, DeliveryStatus.delivered];

const radiusAt = (openedAt: Date, now = Date.now()) => {
  const minutes = (now - openedAt.getTime()) / MINUTE;
  let km: number = DISPATCH.radiusSteps[0][1];
  for (const [after, radius] of DISPATCH.radiusSteps) if (minutes >= after) km = radius;
  return km;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

interface RiderLite {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  lastLocation?: { coordinates: [number, number] };
  lastLocationAt?: Date;
  transitRoutes?: { fromStationId?: Types.ObjectId; toStationId?: Types.ObjectId }[];
  activeDeliveryCount?: number;
  cashLimit?: number;
}

const RIDER_FIELDS = "userId lastLocation lastLocationAt transitRoutes activeDeliveryCount cashLimit";

type LegLite = Pick<
  IDelivery,
  "legType" | "fromKind" | "fromRefId" | "toRefId" | "fromLocation" | "offerOpenedAt"
>;

/** Who may see this leg now, and how far they are from its pickup point. */
const reach = (
  leg: LegLite,
  rider: RiderLite,
  ctx: { linked: boolean; ownStore: boolean; now?: number },
): { visible: boolean; pickupKm?: number; servesRoute: boolean } => {
  const now = ctx.now ?? Date.now();
  const fresh = rider.lastLocationAt && now - rider.lastLocationAt.getTime() <= DISPATCH.locationFreshMinutes * MINUTE;
  const coords = rider.lastLocation?.coordinates;
  const lastKm = coords ? round1(calculateDistanceKm(leg.fromLocation.coordinates, coords)) : undefined;
  const pickupKm = fresh ? lastKm : undefined;
  const servesRoute =
    leg.legType === LegType.line_haul &&
    (rider.transitRoutes ?? []).some(
      (r) => String(r.fromStationId) === String(leg.fromRefId) && String(r.toStationId) === String(leg.toRefId),
    );
  // A store never delivers its own order through its own rider account
  if (ctx.ownStore) return { visible: false, pickupKm, servesRoute };
  const radius = leg.offerOpenedAt ? radiusAt(leg.offerOpenedAt, now) : 0;
  const visible =
    servesRoute ||
    // The store's own riders see its deliveries from the start, even without a recent position.
    // Their last known one still counts: a far rider's list would otherwise change when it ages
    (ctx.linked && (lastKm === undefined || lastKm <= DISPATCH.maxRadiusKm)) ||
    (pickupKm !== undefined && pickupKm <= radius);
  return { visible, pickupKm, servesRoute };
};

const partnerTypeFor = (legType: LegType) => (legType === LegType.line_haul ? PartnerType.transit : PartnerType.moto);

/** Store (vendor profile id → owner user id) of the legs that leave a store. */
const storeOwners = async (legs: LegLite[]) => {
  const ids = [...new Set(legs.filter((l) => l.fromKind === EndpointKind.vendor).map((l) => String(l.fromRefId)))];
  if (!ids.length) return new Map<string, string>();
  const vendors = await VendorProfile.find({ _id: { $in: ids } }).select("userId").lean();
  return new Map(vendors.map((v) => [String(v._id), String(v.userId)]));
};

/** Why a rider can't take a parcel: `code` goes to the offer list, `error` is thrown on accept */
interface Blocker {
  code: "on_ride" | "too_many" | "cash_limit";
  error: ErrorCode;
  params?: MessageParams;
}

/** Can this rider take one more parcel (count, cash limit)? null = yes, else the reason. */
const blockerFor = async (
  rider: RiderLite,
  leg: Pick<IDelivery, "legType" | "collectsCash">,
  cash: number,
): Promise<Blocker | null> => {
  if (leg.legType !== LegType.line_haul && (await Ride.exists({ riderId: rider._id, status: { $in: ACTIVE_RIDE } }))) {
    return { code: "on_ride", error: "FINISH_CURRENT_RIDE" };
  }
  if (leg.legType !== LegType.line_haul && (rider.activeDeliveryCount ?? 0) >= DISPATCH.maxActiveMoto) {
    return { code: "too_many", error: "TOO_MANY_ACTIVE_DELIVERIES", params: { max: DISPATCH.maxActiveMoto } };
  }
  if (leg.collectsCash && cash > 0) {
    const settings = await SettingsServices.getSettings();
    const maxCash = rider.cashLimit || settings.riderCashLimitDefault || 500000;
    const wallet = await WalletServices.ensureWallet(rider.userId, WalletMode.rider);
    const total = (wallet.cashOwed || 0) + cash;
    if (total > maxCash) {
      return {
        code: "cash_limit",
        error: "RIDER_CASH_LIMIT",
        params: { total, limit: maxCash },
      };
    }
  }
  return null;
};

// ── Opening and announcing ──────────────────────────────────────────

/**
 * Tells the riders who can now see an open leg (it opened, or the radius grew).
 * Each rider is told once per leg.
 */
const announce = async (legId: Types.ObjectId | string) => {
  const leg = await Delivery.findOne({
    _id: legId,
    status: DeliveryStatus.pending_assignment,
    offerOpenedAt: { $exists: true },
  }).select("+offerNotified +offerSkippedBy");
  if (!leg?.offerOpenedAt) return;

  const now = Date.now();
  const told = new Set([...(leg.offerNotified ?? []), ...(leg.offerSkippedBy ?? [])].map(String));
  const fromStore = leg.fromKind === EndpointKind.vendor;
  const [owners, links, riders, subOrder] = await Promise.all([
    storeOwners([leg]),
    fromStore
      ? VendorRiderLink.find({ vendorId: leg.fromRefId, status: LinkStatus.active }).select("riderId").lean()
      : Promise.resolve([]),
    RiderProfile.find({
      approvalStatus: ApprovalStatus.approved,
      partnerType: partnerTypeFor(leg.legType),
      isOnline: true,
    })
      .select(RIDER_FIELDS)
      .lean<RiderLite[]>(),
    SubOrder.findById(leg.subOrderId).select("codAmountToCollect").lean(),
  ]);
  const linked = new Set(links.map((l) => String(l.riderId)));
  const owner = owners.get(String(leg.fromRefId));

  const fresh = riders
    .filter((r) => !told.has(String(r._id)))
    .map((r) => ({ rider: r, ...reach(leg, r, { linked: linked.has(String(r._id)), ownStore: String(r.userId) === owner, now }) }))
    .filter((r) => r.visible);

  await Delivery.updateOne(
    { _id: leg._id },
    {
      $set: { offerRadiusKm: radiusAt(leg.offerOpenedAt, now) },
      ...(fresh.length && { $addToSet: { offerNotified: { $each: fresh.map((r) => r.rider._id) } } }),
    },
  );
  for (const { rider, pickupKm } of fresh) {
    Notify.deliveryOffer(rider.userId, leg, pickupKm, subOrder?.codAmountToCollect);
    emitToUser(String(rider.userId), "delivery:offer", { deliveryId: leg._id, fee: leg.fee, pickupKm });
  }
};

/**
 * Opens the legs of a sub-order that are ready to be offered (see the header).
 * Safe to call any time: a leg opens only once, and only while nobody has it.
 */
const openLegsForSubOrder = async (subOrderId: Types.ObjectId | string) => {
  const subOrder = await SubOrder.findById(subOrderId).select("status").lean();
  if (!subOrder || !OPEN_SUB_ORDER.includes(subOrder.status)) return;
  const legs = await Delivery.find({ subOrderId }).select("legNumber status offerOpenedAt").sort({ legNumber: 1 }).lean();
  for (const leg of legs) {
    if (leg.status !== DeliveryStatus.pending_assignment) continue;
    const before = legs.find((l) => l.legNumber === leg.legNumber - 1);
    const ready = leg.legNumber === 1 || Boolean(before && MOVING_LEG.includes(before.status));
    if (!ready) continue;
    if (!leg.offerOpenedAt) {
      const opened = await Delivery.updateOne(
        { _id: leg._id, status: DeliveryStatus.pending_assignment, offerOpenedAt: { $exists: false } },
        { $set: { offerOpenedAt: new Date(), offerRadiusKm: DISPATCH.radiusSteps[0][1] } },
      );
      if (!opened.modifiedCount) continue;
    }
    await announce(leg._id);
  }
};

/** Fire-and-forget version for the order / delivery flows: never fails them. */
const openLegsSoon = (subOrderId: Types.ObjectId | string) => {
  openLegsForSubOrder(subOrderId).catch((error) =>
    logger.error("Opening delivery offers failed", {
      subOrderId: String(subOrderId),
      error: error instanceof Error ? error.message : error,
    }),
  );
};

/**
 * The leg is no longer open to the riders who were told (taken, or sent by the store to
 * one rider): it leaves their lists with its notification, and if it opens again they are
 * told again (client, 2026-11-04: an alert that leads to nothing looks like a broken app).
 */
const withdrawOffer = async (legId: Types.ObjectId | string, keepRiderId?: Types.ObjectId | string) => {
  const leg = await Delivery.findOneAndUpdate({ _id: legId }, { $unset: { offerNotified: 1 } })
    .select("+offerNotified")
    .lean();
  const told = (leg?.offerNotified ?? []).filter((id) => String(id) !== String(keepRiderId));
  if (!told.length) return;
  const riders = await RiderProfile.find({ _id: { $in: told } }).select("userId").lean();
  const userIds = riders.map((r) => r.userId);
  await Notification.deleteMany({ userId: { $in: userIds }, "data.deliveryId": String(legId), "data.offer": true });
  for (const userId of userIds) emitToUser(String(userId), "delivery:offer_gone", { deliveryId: legId });
};

// ── The rider's side ────────────────────────────────────────────────

/**
 * Open legs I can see right now, nearest first: distance to the pickup, trip
 * length, what I earn, the cash to collect. No phone, no exact customer
 * address before accepting (area only).
 */
const getOffers = async (riderUserId: string) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId, approvalStatus: ApprovalStatus.approved })
    .select(`${RIDER_FIELDS} isOnline partnerType`)
    .lean<RiderLite & { isOnline?: boolean; partnerType?: PartnerType }>();
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "RIDER_PROFILE_NOT_FOUND");
  if (!rider.isOnline) return { isOnline: false, offers: [] };

  const legs = await Delivery.find({
    status: DeliveryStatus.pending_assignment,
    offerOpenedAt: { $exists: true },
    offerSkippedBy: { $ne: rider._id },
    legType: rider.partnerType === PartnerType.transit ? LegType.line_haul : { $ne: LegType.line_haul },
  })
    .populate("subOrderId", "subOrderNumber codAmountToCollect items.qty items.removed")
    .populate("orderId", "deliveryType")
    .lean();

  const [owners, links] = await Promise.all([
    storeOwners(legs),
    VendorRiderLink.find({ riderId: rider._id, status: LinkStatus.active }).select("vendorId").lean(),
  ]);
  const myStores = new Set(links.map((l) => String(l.vendorId)));
  const now = Date.now();

  const offers = [];
  for (const leg of legs) {
    const fromStore = leg.fromKind === EndpointKind.vendor;
    const linked = fromStore && myStores.has(String(leg.fromRefId));
    const seen = reach(leg, rider, { linked, ownStore: owners.get(String(leg.fromRefId)) === riderUserId, now });
    if (!seen.visible) continue;
    const so = leg.subOrderId as unknown as {
      subOrderNumber?: string;
      codAmountToCollect?: number;
      items?: { qty: number; removed?: boolean }[];
    } | null;
    const order = leg.orderId as unknown as { deliveryType?: string } | null;
    const cash = leg.collectsCash ? so?.codAmountToCollect ?? 0 : 0;
    const blocker = await blockerFor(rider, leg, cash);
    offers.push({
      _id: leg._id,
      legType: leg.legType,
      legNumber: leg.legNumber,
      deliveryType: order?.deliveryType,
      subOrderNumber: so?.subOrderNumber,
      itemCount: (so?.items ?? []).filter((i) => !i.removed).reduce((n, i) => n + i.qty, 0),
      fromKind: leg.fromKind,
      fromName: leg.fromName,
      fromAddressText: leg.fromAddressText,
      fromLocation: leg.fromLocation,
      toKind: leg.toKind,
      toName: leg.toKind === EndpointKind.customer ? undefined : leg.toName,
      // The customer's area only (city, neighbourhood) until the rider accepts
      toArea: leg.toAddressText,
      fee: leg.fee,
      collectsCash: Boolean(cash),
      cashToCollect: cash,
      pickupKm: seen.pickupKm,
      tripKm: round1(calculateDistanceKm(leg.fromLocation.coordinates, leg.toLocation.coordinates)),
      fromMyStore: linked,
      servesRoute: seen.servesRoute || undefined,
      openedAt: leg.offerOpenedAt,
      canTake: !blocker,
      ...(blocker && { blockedReason: blocker.code }),
    });
  }
  offers.sort((a, b) => (a.pickupKm ?? Number.MAX_SAFE_INTEGER) - (b.pickupKm ?? Number.MAX_SAFE_INTEGER));
  return { isOnline: true, offers };
};

/** The first rider to accept an open leg takes it (atomic: two riders can't both get it). */
const claimOffer = async (riderUserId: string, deliveryId: string) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId, approvalStatus: ApprovalStatus.approved })
    .select(`${RIDER_FIELDS} isOnline partnerType`)
    .lean<RiderLite & { isOnline?: boolean; partnerType?: PartnerType }>();
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "RIDER_PROFILE_NOT_FOUND");
  if (!rider.isOnline) throw new AppError(httpStatus.BAD_REQUEST, "GO_ONLINE_FOR_DELIVERIES");

  const leg = await Delivery.findById(deliveryId).select("+offerSkippedBy");
  if (!leg) throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_NOT_FOUND");
  const open = leg.status === DeliveryStatus.pending_assignment && Boolean(leg.offerOpenedAt);
  if (!open) {
    if (leg.riderId || leg.status !== DeliveryStatus.pending_assignment) {
      throw new AppError(httpStatus.CONFLICT, "DELIVERY_ALREADY_TAKEN");
    }
    throw new AppError(httpStatus.BAD_REQUEST, "OFFER_NOT_OPEN");
  }
  if (partnerTypeFor(leg.legType) !== rider.partnerType) {
    throw new AppError(httpStatus.BAD_REQUEST, "OFFER_NOT_FOR_YOU");
  }

  const fromStore = leg.fromKind === EndpointKind.vendor;
  const [owners, link] = await Promise.all([
    storeOwners([leg]),
    fromStore ? VendorRiderLink.exists({ vendorId: leg.fromRefId, riderId: rider._id, status: LinkStatus.active }) : null,
  ]);
  const seen = reach(leg, rider, { linked: Boolean(link), ownStore: owners.get(String(leg.fromRefId)) === riderUserId });
  if (!seen.visible) throw new AppError(httpStatus.BAD_REQUEST, "OFFER_NOT_FOR_YOU");

  const subOrder = await SubOrder.findById(leg.subOrderId).select("subOrderNumber codAmountToCollect vendorId").lean();
  const cash = leg.collectsCash ? subOrder?.codAmountToCollect ?? 0 : 0;
  const blocker = await blockerFor(rider, leg, cash);
  if (blocker) throw new AppError(httpStatus.BAD_REQUEST, blocker.error, blocker.params);

  const now = new Date();
  const taken = await Delivery.findOneAndUpdate(
    { _id: leg._id, status: DeliveryStatus.pending_assignment, offerOpenedAt: { $exists: true } },
    {
      $set: {
        riderId: rider._id,
        assignedBy: rider.userId,
        assignedAt: now,
        acceptedAt: now,
        status: DeliveryStatus.accepted,
      },
      $unset: { reservedUntil: 1, declineReason: 1 },
    },
    { returnDocument: "after" },
  );
  if (!taken) throw new AppError(httpStatus.CONFLICT, "DELIVERY_ALREADY_TAKEN");

  await RiderProfile.updateOne({ _id: rider._id }, { $inc: { activeDeliveryCount: 1 } });
  await SubOrder.findByIdAndUpdate(leg.subOrderId, {
    currentRiderId: rider._id,
    $push: {
      timeline: {
        status: "rider_accepted",
        params: { leg: leg.legNumber },
        byUserId: new Types.ObjectId(riderUserId),
        at: now,
      },
    },
  });

  emitToDelivery(String(leg._id), "delivery:status_changed", { status: DeliveryStatus.accepted, riderId: rider._id });
  await withdrawOffer(leg._id, rider._id);
  if (fromStore && subOrder) {
    const vendor = await VendorProfile.findById(subOrder.vendorId).select("userId").lean();
    const me = await User.findById(riderUserId).select("name").lean();
    if (vendor) {
      emitToUser(String(vendor.userId), "delivery:status_changed", { deliveryId: leg._id, status: DeliveryStatus.accepted });
      Notify.deliveryTaken(vendor.userId, leg, me?.name ?? "Rider", subOrder.subOrderNumber);
    }
  }

  return taken.toObject();
};

/** "Not for me": the offer leaves my list. */
const skipOffer = async (riderUserId: string, deliveryId: string) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId }).select("_id").lean();
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "RIDER_PROFILE_NOT_FOUND");
  const result = await Delivery.updateOne({ _id: deliveryId }, { $addToSet: { offerSkippedBy: rider._id } });
  if (!result.matchedCount) throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_NOT_FOUND");
  return { skipped: true };
};

// ── Sweep ───────────────────────────────────────────────────────────

/** The rider chosen by the store didn't answer in time: the leg goes back to everyone. */
const expireReservations = async () => {
  const due = await Delivery.find({ status: DeliveryStatus.assigned, reservedUntil: { $lte: new Date() } })
    .select("subOrderId riderId fromKind fromName toName fee collectsCash")
    .lean();
  for (const leg of due) {
    const freed = await Delivery.findOneAndUpdate(
      { _id: leg._id, status: DeliveryStatus.assigned, reservedUntil: { $lte: new Date() } },
      {
        $set: { status: DeliveryStatus.pending_assignment },
        $unset: { riderId: 1, reservedUntil: 1 },
        ...(leg.riderId && { $addToSet: { offerSkippedBy: leg.riderId } }),
      },
    );
    if (!freed) continue;
    await SubOrder.updateOne({ _id: leg.subOrderId, currentRiderId: leg.riderId }, { $unset: { currentRiderId: 1 } });
    const riderUser = leg.riderId ? await RiderProfile.findById(leg.riderId).select("userId").populate("userId", "name").lean() : null;
    const user = riderUser?.userId as unknown as { _id: Types.ObjectId; name?: string } | undefined;
    if (user) emitToUser(String(user._id), "delivery:withdrawn", { deliveryId: leg._id });
    emitToDelivery(String(leg._id), "delivery:status_changed", { status: DeliveryStatus.pending_assignment });
    if (leg.fromKind === EndpointKind.vendor) {
      const subOrder = await SubOrder.findById(leg.subOrderId).select("vendorId").lean();
      const vendor = subOrder ? await VendorProfile.findById(subOrder.vendorId).select("userId").lean() : null;
      if (vendor) {
        emitToUser(String(vendor.userId), "delivery:status_changed", { deliveryId: leg._id, status: DeliveryStatus.pending_assignment });
        Notify.reservationExpired(vendor.userId, leg, user?.name ?? "Rider");
      }
    }
    await openLegsForSubOrder(leg.subOrderId);
  }
};

/** Nobody took it for a while → the store and the Kadou24h team (once per leg). */
const alertUnclaimed = async () => {
  const now = Date.now();
  const legs = await Delivery.find({
    status: DeliveryStatus.pending_assignment,
    offerOpenedAt: { $lte: new Date(now - DISPATCH.alertAfterMinutes.store * MINUTE) },
    noRiderAlertedAt: { $exists: false },
  }).lean();
  let staffIds: Types.ObjectId[] | null = null;
  for (const leg of legs) {
    const fromStore = leg.fromKind === EndpointKind.vendor;
    const after = fromStore ? DISPATCH.alertAfterMinutes.store : DISPATCH.alertAfterMinutes.station;
    if (!leg.offerOpenedAt || now - leg.offerOpenedAt.getTime() < after * MINUTE) continue;
    const marked = await Delivery.updateOne(
      { _id: leg._id, noRiderAlertedAt: { $exists: false } },
      { $set: { noRiderAlertedAt: new Date() } },
    );
    if (!marked.modifiedCount) continue;
    const subOrder = await SubOrder.findById(leg.subOrderId).select("subOrderNumber vendorId").lean();
    if (!subOrder) continue;
    const vendor = fromStore ? await VendorProfile.findById(subOrder.vendorId).select("userId").lean() : null;
    staffIds ??= (
      await User.find({ roles: { $in: ADMIN_ROLES }, status: UserStatus.active }).select("_id").lean()
    ).map((u) => u._id as Types.ObjectId);
    const minutes = Math.round((now - leg.offerOpenedAt.getTime()) / MINUTE);
    Notify.noRiderYet(leg, subOrder.subOrderNumber, minutes, vendor?.userId, staffIds);
  }
};

const sweep = async () => {
  await expireReservations();

  // Legs that should be open but aren't (an admin moved the order, a restart…)
  const closed = await Delivery.distinct("subOrderId", {
    status: DeliveryStatus.pending_assignment,
    offerOpenedAt: { $exists: false },
  });
  if (closed.length) {
    const active = await SubOrder.find({ _id: { $in: closed }, status: { $in: OPEN_SUB_ORDER } }).select("_id").lean();
    for (const so of active) await openLegsForSubOrder(so._id);
  }

  // Open legs: the radius grows, so new riders may be in reach
  const open = await Delivery.find({ status: DeliveryStatus.pending_assignment, offerOpenedAt: { $exists: true } })
    .select("_id")
    .lean();
  for (const leg of open) await announce(leg._id);

  await alertUnclaimed();
};

const startDispatchSweep = () => {
  const run = () =>
    sweep().catch((error) => logger.error("Dispatch sweep failed", { error: error instanceof Error ? error.message : error }));
  void run();
  const timer = setInterval(run, DISPATCH.sweepEveryMs);
  timer.unref();
  return timer;
};

export const DeliveryDispatch = {
  announce,
  withdrawOffer,
  openLegsForSubOrder,
  openLegsSoon,
  getOffers,
  claimOffer,
  skipOffer,
  expireReservations,
  sweep,
  startDispatchSweep,
};

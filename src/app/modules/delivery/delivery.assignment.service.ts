/**
 * Rider assignment: available riders, assign, accept, decline.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { emitToDelivery, emitToUser } from "../../../socket/socket";
import { calculateDistanceKm } from "../delivery_rate/delivery_rate.service";
import { SubOrder } from "../order/sub_order.model";
import { ApprovalStatus } from "../profile_common/profile.common";
import { PartnerType } from "../rider_profile/rider_profile.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { UserRole } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { LinkStatus } from "../vendor_rider_link/vendor_rider_link.interface";
import { VendorRiderLink } from "../vendor_rider_link/vendor_rider_link.model";
import { DeliveryStatus, EndpointKind, IAvailableRider, LegType } from "./delivery.interface";
import { Delivery } from "./delivery.model";
import { WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import { Notify } from "../notification/notification.events";
import { DISPATCH, DeliveryDispatch } from "./delivery.dispatch.service";

/**
 * Lists available online delivery partners for a delivery leg.
 * Prioritizes active linked riders, then sorts nearby online riders by distance.
 */
const getAvailableRiders = async (
  vendorUserId: string,
  deliveryId: string,
): Promise<IAvailableRider[]> => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) throw new AppError(httpStatus.FORBIDDEN, "VENDOR_PROFILE_NOT_FOUND");

  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_NOT_FOUND");

  // Only the store of this order may see who is online nearby (riders' positions)
  const ownsLeg = await SubOrder.exists({ _id: delivery.subOrderId, vendorId: vendor._id });
  if (!ownsLeg) throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_NOT_FOUND");

  // Determine required partner type: bus drivers for line_haul, moto riders for local/first_mile/last_mile
  const requiredPartnerType =
    delivery.legType === LegType.line_haul ? PartnerType.transit : PartnerType.moto;

  // Active linked riders for this vendor
  const links = await VendorRiderLink.find({
    vendorId: vendor._id,
    status: LinkStatus.active,
  });
  const linkedRiderIds = new Set(links.map((l) => String(l.riderId)));

  // Query online approved riders
  const onlineRiders = await RiderProfile.find({
    approvalStatus: ApprovalStatus.approved,
    partnerType: requiredPartnerType,
    isOnline: true,
  }).populate("userId", "name avatar");

  const originCoords = delivery.fromLocation.coordinates;
  // Bus leg: drivers who run this exact station → station route come first
  const isBusLeg = delivery.legType === LegType.line_haul;
  const runsThisRoute = (rider: (typeof onlineRiders)[number]) =>
    isBusLeg &&
    (rider.transitRoutes ?? []).some(
      (r) => String(r.fromStationId) === String(delivery.fromRefId) && String(r.toStationId) === String(delivery.toRefId),
    );

  const ridersList: IAvailableRider[] = onlineRiders.map((rider) => {
    const isLinked = linkedRiderIds.has(String(rider._id));
    const riderCoords = rider.lastLocation?.coordinates;
    const distanceKm = riderCoords
      ? calculateDistanceKm(originCoords, riderCoords)
      : undefined;

    // populated above with name, avatar — no phone: contact goes through in-app chat (client rule)
    const user = rider.userId as unknown as {
      _id?: Types.ObjectId;
      name?: string;
      avatar?: { url?: string };
    } | null;
    return {
      _id: String(rider._id),
      userId: String(user?._id ?? rider.userId),
      name: user?.name || "Rider",
      avatar: user?.avatar?.url,
      partnerType: rider.partnerType || "moto",
      vehicleType: rider.vehicle?.type || "motorbike",
      vehicleBrand: rider.vehicle?.brand,
      plateNumber: rider.vehicle?.plateNumber,
      isLinked,
      ...(isBusLeg && { servesRoute: runsThisRoute(rider) }),
      ratingAvg: rider.stats?.ratingAvg || 0,
      totalDeliveries: rider.stats?.totalDeliveries || 0,
      activeDeliveryCount: rider.activeDeliveryCount || 0,
      distanceKm,
      currentLocation: riderCoords,
    };
  });

  // Sort: bus leg → drivers of this route first; leg leaving the store → my
  // linked riders first (they're in my town; a leg leaving a far station is
  // not); then the nearest to the pickup point.
  const fromStore = delivery.fromKind === EndpointKind.vendor;
  const rank = (r: IAvailableRider) => (isBusLeg ? (r.servesRoute ? 0 : 1) : fromStore && r.isLinked ? 0 : 1);
  ridersList.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm !== undefined) return -1;
    if (b.distanceKm !== undefined) return 1;
    return 0;
  });

  return ridersList;
};

/**
 * Sends a delivery leg to one rider (the store's choice). Open dispatch: the
 * rider has DISPATCH.reserveMinutes to accept, then the leg goes back to the
 * nearby riders (see delivery.dispatch.service).
 */
const assignRider = async (
  actorUserId: string,
  deliveryId: string,
  riderId: string,
) => {
  const actor = await User.findById(actorUserId);
  if (!actor) throw new AppError(httpStatus.UNAUTHORIZED, "ACCOUNT_NOT_FOUND");

  const isAdminOrStaff = actor.roles?.some((r) =>
    [UserRole.staff, UserRole.admin, UserRole.super_admin].includes(r),
  );

  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_NOT_FOUND");

  const subOrder = await SubOrder.findById(delivery.subOrderId);
  if (!subOrder) throw new AppError(httpStatus.NOT_FOUND, "SUB_ORDER_NOT_FOUND");

  // Authorization check: Only staff/admin or the order's vendor can assign riders
  if (!isAdminOrStaff) {
    const vendorProfile = await VendorProfile.findOne({ userId: actorUserId });
    if (!vendorProfile || !subOrder.vendorId.equals(vendorProfile._id)) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "ASSIGN_FORBIDDEN",
      );
    }
  }

  if (
    ![DeliveryStatus.pending_assignment, DeliveryStatus.declined].includes(
      delivery.status,
    )
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "ASSIGN_WRONG_STATUS", { status: delivery.status },
    );
  }

  const rider = await RiderProfile.findOne({
    _id: riderId,
    approvalStatus: ApprovalStatus.approved,
  });
  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "PARTNER_NOT_FOUND");

  if (String(rider.userId) === actorUserId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "ASSIGN_SELF",
    );
  }

  if (!rider.isOnline) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "PARTNER_OFFLINE",
    );
  }

  // Atomic: a nearby rider may have taken the open offer meanwhile
  const now = new Date();
  const reserved = await Delivery.findOneAndUpdate(
    { _id: delivery._id, status: { $in: [DeliveryStatus.pending_assignment, DeliveryStatus.declined] } },
    {
      $set: {
        riderId: rider._id,
        assignedBy: new Types.ObjectId(actorUserId),
        assignedAt: now,
        reservedUntil: new Date(now.getTime() + DISPATCH.reserveMinutes * 60_000),
        status: DeliveryStatus.assigned,
      },
    },
    { returnDocument: "after" },
  );
  if (!reserved) {
    throw new AppError(httpStatus.CONFLICT, "DELIVERY_JUST_TAKEN");
  }
  Object.assign(delivery, reserved.toObject());

  // Update sub-order current rider
  await SubOrder.findByIdAndUpdate(delivery.subOrderId, {
    currentRiderId: rider._id,
  });
  Notify.deliveryAssigned(rider.userId, delivery, subOrder.codAmountToCollect, DISPATCH.reserveMinutes);
  // Reserved for this rider: the others lose the offer until the reservation ends
  await DeliveryDispatch.withdrawOffer(delivery._id, rider._id);

  // Real-time notifications
  emitToUser(String(rider.userId), "delivery:assigned", {
    deliveryId: delivery._id,
    subOrderId: delivery.subOrderId,
    legType: delivery.legType,
    fee: delivery.fee,
    fromName: delivery.fromName,
    toName: delivery.toName,
    collectsCash: delivery.collectsCash,
    reservedUntil: delivery.reservedUntil,
  });

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.assigned,
    riderId: rider._id,
  });

  return delivery;
};

/**
 * Rider accepts an assigned delivery job.
 */
const acceptDelivery = async (riderUserId: string, deliveryId: string) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "RIDER_PROFILE_NOT_FOUND");

  const delivery = await Delivery.findOne({
    _id: deliveryId,
    riderId: rider._id,
    status: DeliveryStatus.assigned,
  });

  if (!delivery) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "DELIVERY_NOT_YOURS",
    );
  }

  // If COD, check rider cash limits
  if (delivery.collectsCash) {
    const settings = await SettingsServices.getSettings();
    const maxCash = rider.cashLimit || settings.riderCashLimitDefault || 500000;
    const subOrder = await SubOrder.findById(delivery.subOrderId);
    const codAmount = subOrder?.codAmountToCollect || 0;
    const riderWallet = await WalletServices.ensureWallet(rider.userId, WalletMode.rider);
    const totalCashRisk = (riderWallet.cashOwed || 0) + codAmount;
    if (totalCashRisk > maxCash) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "RIDER_CASH_LIMIT", { total: totalCashRisk, limit: maxCash },
      );
    }
  }

  // Atomic: the leg may have been cancelled or re-assigned meanwhile
  const accepted = await Delivery.findOneAndUpdate(
    { _id: delivery._id, riderId: rider._id, status: DeliveryStatus.assigned },
    { $set: { status: DeliveryStatus.accepted, acceptedAt: new Date() }, $unset: { reservedUntil: 1 } },
    { returnDocument: "after" },
  );
  if (!accepted) {
    throw new AppError(httpStatus.CONFLICT, "DELIVERY_NOT_YOURS");
  }

  await RiderProfile.updateOne({ _id: rider._id }, { $inc: { activeDeliveryCount: 1 } });

  // Append timeline to sub-order
  await SubOrder.findByIdAndUpdate(delivery.subOrderId, {
    $push: {
      timeline: {
        status: "rider_accepted",
        note: `Delivery partner accepted leg #${delivery.legNumber}`,
        byUserId: new Types.ObjectId(riderUserId),
        at: new Date(),
      },
    },
  });

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.accepted,
    riderId: rider._id,
  });

  return accepted;
};

/**
 * Rider declines assigned job; reverts leg to pending_assignment and offers it
 * to the nearby riders again (not to this one).
 */
const declineDelivery = async (
  riderUserId: string,
  deliveryId: string,
  reason: string,
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "RIDER_PROFILE_NOT_FOUND");

  // Atomic, so a leg cancelled meanwhile is not brought back to pending_assignment
  const delivery = await Delivery.findOneAndUpdate(
    { _id: deliveryId, riderId: rider._id, status: DeliveryStatus.assigned },
    {
      $set: { status: DeliveryStatus.pending_assignment, declineReason: reason },
      $unset: { riderId: 1, reservedUntil: 1 },
      $addToSet: { offerSkippedBy: rider._id },
    },
    { returnDocument: "after" },
  );

  if (!delivery) {
    throw new AppError(httpStatus.NOT_FOUND, "DELIVERY_NOT_YOURS");
  }

  // Notify vendor that rider declined
  const subOrder = await SubOrder.findById(delivery.subOrderId);
  if (subOrder) {
    const vendor = await VendorProfile.findById(subOrder.vendorId);
    if (vendor) {
      emitToUser(String(vendor.userId), "delivery:declined", {
        deliveryId: delivery._id,
        subOrderId: subOrder._id,
        reason,
      });
      Notify.deliveryDeclined(vendor.userId, delivery, reason);
    }
  }

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.pending_assignment,
  });
  DeliveryDispatch.openLegsSoon(delivery.subOrderId);

  return delivery;
};

export {
  getAvailableRiders,
  assignRider,
  acceptDelivery,
  declineDelivery,
};

/**
 * Tracking, live location, online status and the rider's job list.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { emitToDelivery } from "../../../socket/socket";
import { DeliveryType } from "../order/order.interface";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { UserRole } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { DeliveryStatus, EndpointKind, LegType } from "./delivery.interface";
import { Delivery } from "./delivery.model";
import { withoutPins } from "./delivery.utils";

/**
 * Riders see the customer's address (name, phone, landmark, gate photo) only
 * on the leg that ends with the customer: the door (local / last mile) or,
 * for "station pickup" orders, the bus that the customer meets at the
 * destination station. A first-mile rider or a relay bus driver never meets
 * the customer.
 */
const withoutCustomerAddress = <T extends { toKind: EndpointKind; legType: LegType; orderId?: unknown; toPhone?: string }>(leg: T): T => {
  const order = leg.orderId && typeof leg.orderId === "object" ? { ...(leg.orderId as Record<string, unknown>) } : null;
  const meetsCustomer =
    leg.toKind === EndpointKind.customer ||
    (leg.legType === LegType.line_haul && order?.deliveryType === DeliveryType.station_pickup);
  if (meetsCustomer || !order) return leg;
  delete order.addressSnapshot;
  return { ...leg, orderId: order, toPhone: undefined };
};

/**
 * Returns tracking details for customer, vendor, or rider with secure PIN exposure.
 */
const trackDelivery = async (
  userId: string,
  deliveryId: string,
) => {
  const delivery = await Delivery.findById(deliveryId)
    .select("+pickupPin +handoverPin")
    .populate({
      path: "riderId",
      select: "userId partnerType vehicle stats lastLocation lastLocationAt",
      populate: { path: "userId", select: "name avatar" },
    })
    .populate("subOrderId", "subOrderNumber status total items.name items.qty items.image items.removed codAmountToCollect")
    .populate("orderId", "orderNumber addressSnapshot paymentMethod deliveryType");

  if (!delivery) throw new AppError(httpStatus.NOT_FOUND, "Delivery not found");

  const subOrder = await SubOrder.findById(delivery.subOrderId);
  const order = await Order.findById(delivery.orderId);
  const vendor = subOrder ? await VendorProfile.findById(subOrder.vendorId) : null;
  const riderProfile = await RiderProfile.findOne({ userId });
  const user = await User.findById(userId);

  const isStaffOrAdmin = user?.roles?.some((r) =>
    [UserRole.staff, UserRole.admin, UserRole.super_admin].includes(r),
  );

  // At a bus station the parcel passes rider → rider, so the person on the other
  // side of the handover is the rider of the adjacent leg (e.g. the bus driver).
  const [prevLeg, nextLeg] = await Promise.all([
    Delivery.findOne({ subOrderId: delivery.subOrderId, legNumber: delivery.legNumber - 1 }).select("riderId toKind +handoverPin"),
    Delivery.findOne({ subOrderId: delivery.subOrderId, legNumber: delivery.legNumber + 1 }).select("riderId fromKind +pickupPin"),
  ]);
  const myRiderId = riderProfile ? String(riderProfile._id) : null;
  const ridesPrevLeg = Boolean(myRiderId && prevLeg?.riderId && String(prevLeg.riderId) === myRiderId);
  const ridesNextLeg = Boolean(myRiderId && nextLeg?.riderId && String(nextLeg.riderId) === myRiderId);

  const isVendor = String(vendor?.userId) === userId;
  const isCustomer = String(order?.customerId) === userId;

  // Security: only the giver sees pickupPin, only the receiver sees handoverPin.
  // The vendor gives only on the leg that starts at the store, and the customer
  // receives only on the final leg — middle legs are station → station relays.
  const isGiver =
    (isVendor && delivery.fromKind === EndpointKind.vendor) ||
    (delivery.fromKind === EndpointKind.station && (ridesPrevLeg || Boolean(isStaffOrAdmin)));

  const isReceiver =
    (isCustomer && !nextLeg) ||
    (delivery.toKind === EndpointKind.station && (ridesNextLeg || Boolean(isStaffOrAdmin)));

  // riderId is populated above, so compare against its _id, not the object
  const assignedRiderId = (delivery.riderId as unknown as { _id?: Types.ObjectId } | null)?._id
    ?? delivery.riderId;
  const isRider = Boolean(riderProfile && assignedRiderId && String(riderProfile._id) === String(assignedRiderId));

  // The store and the buyer may follow every leg of their order (map, status)
  if (!isVendor && !isCustomer && !isGiver && !isReceiver && !isRider && !isStaffOrAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You are not authorized to view tracking for this delivery",
    );
  }

  const deliveryObj = delivery.toObject();

  // Only the giver sees pickupPin and only the receiver sees handoverPin;
  // bcrypt hashes are never sent
  const visiblePins = {
    ...(isGiver && { pickupPin: deliveryObj.pickupPin }),
    ...(isReceiver && { handoverPin: deliveryObj.handoverPin }),
  };

  // Station handovers seen from my own leg (bus driver / relay riders):
  // - incomingHandoverPin: show it to the rider arriving with the parcel
  // - outgoingPickupPin:   show it to the rider who takes the parcel next
  const relayPins = isRider
    ? {
        incomingHandoverPin:
          prevLeg?.toKind === EndpointKind.station ? prevLeg.handoverPin : undefined,
        outgoingPickupPin:
          nextLeg?.fromKind === EndpointKind.station ? nextLeg.pickupPin : undefined,
      }
    : {};

  // Client rule: the buyer never gets the store's phone (chat instead). The store
  // and the riders keep the contact numbers they need for the handover.
  const contacts =
    isCustomer && !isVendor && !isRider && !isStaffOrAdmin ? { fromPhone: undefined } : {};
  // Riders (this leg's or the next / previous one's at a station) on a leg that
  // ends at a station never meet the customer
  const view = !isVendor && !isCustomer && !isStaffOrAdmin ? withoutCustomerAddress(deliveryObj) : deliveryObj;

  return {
    ...withoutPins(view),
    ...contacts,
    ...visiblePins,
    ...relayPins,
    isGiver,
    isReceiver,
    isRider,
  };
};

/**
 * Rider broadcasts their live GPS coordinate.
 */
const updateRiderLocation = async (
  riderUserId: string,
  lat: number,
  lng: number,
  heading?: number,
) => {
  const geoPoint = toGeoPoint({ lat, lng });

  await RiderProfile.findOneAndUpdate(
    { userId: riderUserId },
    {
      $set: {
        lastLocation: geoPoint,
        lastLocationAt: new Date(),
      },
    },
  );

  // Broadcast to all active deliveries assigned to this rider
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (rider) {
    const activeDeliveries = await Delivery.find({
      riderId: rider._id,
      status: {
        $in: [
          DeliveryStatus.accepted,
          DeliveryStatus.going_to_pickup,
          DeliveryStatus.picked_up,
          DeliveryStatus.in_transit,
        ],
      },
    });

    for (const d of activeDeliveries) {
      emitToDelivery(String(d._id), "rider:location_updated", {
        deliveryId: d._id,
        lat,
        lng,
        heading,
      });
    }
  }

  return { lat, lng, heading };
};

/**
 * Rider toggles Driver Mode (online / offline).
 */
const toggleRiderOnline = async (riderUserId: string, isOnline: boolean) => {
  const rider = await RiderProfile.findOneAndUpdate(
    { userId: riderUserId },
    { $set: { isOnline } },
    { returnDocument: "after" },
  );

  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "Rider profile not found");
  return { isOnline: rider.isOnline };
};

// The rider app's tabs: waiting for my answer · on the road · finished
const RIDER_TABS: Record<string, DeliveryStatus[]> = {
  new: [DeliveryStatus.assigned],
  active: [
    DeliveryStatus.assigned,
    DeliveryStatus.accepted,
    DeliveryStatus.going_to_pickup,
    DeliveryStatus.picked_up,
    DeliveryStatus.in_transit,
  ],
  ongoing: [
    DeliveryStatus.accepted,
    DeliveryStatus.going_to_pickup,
    DeliveryStatus.picked_up,
    DeliveryStatus.in_transit,
  ],
  completed: [DeliveryStatus.delivered, DeliveryStatus.cancelled],
};

/**
 * Rider's jobs. `type`: new (to accept) · ongoing (accepted, on the road) ·
 * completed · active (new + ongoing). Paginated; newest first, except the
 * running ones (oldest first: the job taken first is done first).
 */
const getMyDeliveries = async (
  riderUserId: string,
  query: { status?: DeliveryStatus; type?: string; page?: string; limit?: string },
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const filter: Record<string, unknown> = { riderId: rider._id };
  if (query.status) filter.status = query.status;
  else if (query.type && RIDER_TABS[query.type]) filter.status = { $in: RIDER_TABS[query.type] };

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const running = query.type === "new" || query.type === "ongoing" || query.type === "active";

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate("subOrderId", "subOrderNumber total items.name items.qty items.removed codAmountToCollect")
      .populate("orderId", "orderNumber addressSnapshot paymentMethod deliveryType")
      .sort(running ? { assignedAt: 1, createdAt: 1 } : { updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Delivery.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    // Riders never see the PINs of their own legs
    data: deliveries.map((d) => withoutCustomerAddress(withoutPins(d.toObject()))),
  };
};

export {
  trackDelivery,
  updateRiderLocation,
  toggleRiderOnline,
  getMyDeliveries,
};

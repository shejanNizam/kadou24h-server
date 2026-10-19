/**
 * Tracking, live location, online status and the rider's job list.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { emitToDelivery } from "../../../socket/socket";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { UserRole } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { DeliveryStatus, EndpointKind } from "./delivery.interface";
import { Delivery } from "./delivery.model";
import { withoutPins } from "./delivery.utils";

/**
 * Returns tracking details for customer, vendor, or rider with secure PIN exposure.
 */
const trackDelivery = async (
  userId: string,
  deliveryId: string,
) => {
  const delivery = await Delivery.findById(deliveryId)
    .select("+pickupPin +handoverPin")
    .populate("riderId", "partnerType vehicle stats lastLocation lastLocationAt")
    .populate("subOrderId", "subOrderNumber status total")
    .populate("orderId", "orderNumber addressSnapshot paymentMethod");

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

  return {
    ...withoutPins(deliveryObj),
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

/**
 * Rider retrieves list of assigned, active, or completed jobs.
 */
const getMyDeliveries = async (
  riderUserId: string,
  query: { status?: DeliveryStatus; type?: "active" | "completed" },
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const filter: Record<string, unknown> = { riderId: rider._id };

  if (query.status) {
    filter.status = query.status;
  } else if (query.type === "active") {
    filter.status = {
      $in: [
        DeliveryStatus.assigned,
        DeliveryStatus.accepted,
        DeliveryStatus.going_to_pickup,
        DeliveryStatus.picked_up,
        DeliveryStatus.in_transit,
      ],
    };
  } else if (query.type === "completed") {
    filter.status = {
      $in: [DeliveryStatus.delivered, DeliveryStatus.cancelled],
    };
  }

  const deliveries = await Delivery.find(filter)
    .populate("subOrderId", "subOrderNumber total items")
    .populate("orderId", "orderNumber addressSnapshot paymentMethod")
    .sort({ createdAt: -1 });

  return deliveries.map((d) => {
    // Riders never see the PINs of their own legs
    return withoutPins(d.toObject());
  });
};

export {
  trackDelivery,
  updateRiderLocation,
  toggleRiderOnline,
  getMyDeliveries,
};

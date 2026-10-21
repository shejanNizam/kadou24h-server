/**
 * Pickup and handover with PIN checks; settlement on the final leg.
 */
import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { emitToDelivery } from "../../../socket/socket";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { OrderStatus, PaymentMethod, PaymentStatus, SubOrderStatus } from "../order/order.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { DeliveryStatus, EndpointKind, IDelivery } from "./delivery.interface";
import { Delivery } from "./delivery.model";
import { WalletServices } from "../wallet/wallet.service";
import { Notify } from "../notification/notification.events";
import { syncOrderStatus } from "../order/order.utils";

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

/**
 * Too many wrong PINs lock the leg for 15 minutes. Once the lock has passed,
 * the rider gets a fresh round of attempts (otherwise one more mistake would
 * lock it again at once).
 */
const assertPinUnlocked = (delivery: IDelivery) => {
  if (!delivery.pinLockedUntil) return;
  const minutesLeft = Math.ceil((delivery.pinLockedUntil.getTime() - Date.now()) / 60_000);
  if (minutesLeft > 0) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      `Too many wrong codes. Try again in ${minutesLeft} min.`,
    );
  }
  delivery.pinAttempts = 0;
  delivery.pinLockedUntil = undefined;
};

/**
 * Rider begins moving to pickup location.
 */
const goingToPickup = async (riderUserId: string, deliveryId: string) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const delivery = await Delivery.findOne({
    _id: deliveryId,
    riderId: rider._id,
    status: DeliveryStatus.accepted,
  });

  if (!delivery) {
    throw new AppError(httpStatus.NOT_FOUND, "Accepted delivery not found");
  }

  delivery.status = DeliveryStatus.going_to_pickup;
  await delivery.save();

  await SubOrder.findByIdAndUpdate(delivery.subOrderId, {
    $push: {
      timeline: {
        status: "going_to_pickup",
        note: "Delivery partner is en route to pickup location",
        byUserId: new Types.ObjectId(riderUserId),
        at: new Date(),
      },
    },
  });

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.going_to_pickup,
  });

  return delivery;
};

/**
 * Verifies pickup PIN entered by rider at the giver's location.
 */
const verifyPickup = async (
  riderUserId: string,
  deliveryId: string,
  pin: string,
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const delivery = await Delivery.findOne({
    _id: deliveryId,
    riderId: rider._id,
  }).select("+pickupPinHash");

  if (!delivery) {
    throw new AppError(httpStatus.NOT_FOUND, "Delivery not found");
  }

  if (
    ![DeliveryStatus.accepted, DeliveryStatus.going_to_pickup].includes(
      delivery.status,
    )
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot verify pickup while delivery is in status "${delivery.status}"`,
    );
  }

  assertPinUnlocked(delivery);

  const isMatch = await bcrypt.compare(pin, delivery.pickupPinHash);

  if (!isMatch) {
    delivery.pinAttempts = (delivery.pinAttempts || 0) + 1;
    if (delivery.pinAttempts >= MAX_PIN_ATTEMPTS) {
      delivery.pinLockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000);
    }
    await delivery.save();
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid pickup PIN. ${Math.max(0, MAX_PIN_ATTEMPTS - delivery.pinAttempts)} attempts remaining.`,
    );
  }

  // Match success — claimed atomically so a double tap cannot run this twice
  const pickedUp = await Delivery.findOneAndUpdate(
    {
      _id: delivery._id,
      riderId: rider._id,
      status: { $in: [DeliveryStatus.accepted, DeliveryStatus.going_to_pickup] },
    },
    {
      $set: { status: DeliveryStatus.picked_up, pickedUpAt: new Date(), pinAttempts: 0 },
      $unset: { pinLockedUntil: 1 },
    },
    { returnDocument: "after" },
  );
  if (!pickedUp) {
    throw new AppError(httpStatus.CONFLICT, "This delivery was already updated. Please refresh.");
  }

  // Progress sub-order to in_delivery
  const subOrder = await SubOrder.findByIdAndUpdate(delivery.subOrderId, {
    status: SubOrderStatus.in_delivery,
    $push: {
      timeline: {
        status: "picked_up",
        note: `Parcel picked up by partner from ${delivery.fromName}`,
        byUserId: new Types.ObjectId(riderUserId),
        at: new Date(),
      },
    },
  });

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.picked_up,
  });

  // Last leg (to the customer) is moving → tell the customer
  if (subOrder && pickedUp.toKind === EndpointKind.customer) {
    Notify.riderOnTheWay(subOrder.customerId, pickedUp, subOrder.subOrderNumber);
  }

  return pickedUp;
};

/**
 * Verifies handover PIN entered by rider at the destination.
 * Completes the leg, handles COD cash tracking, and advances order/suborder.
 */
const verifyHandover = async (
  riderUserId: string,
  deliveryId: string,
  pin: string,
  proofPhoto?: { url: string; publicId: string },
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const delivery = await Delivery.findOne({
    _id: deliveryId,
    riderId: rider._id,
  }).select("+handoverPinHash");

  if (!delivery) {
    throw new AppError(httpStatus.NOT_FOUND, "Delivery not found");
  }

  if (
    ![DeliveryStatus.picked_up, DeliveryStatus.in_transit].includes(
      delivery.status,
    )
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot verify handover while delivery is in status "${delivery.status}"`,
    );
  }

  assertPinUnlocked(delivery);

  const isMatch = await bcrypt.compare(pin, delivery.handoverPinHash);

  if (!isMatch) {
    delivery.pinAttempts = (delivery.pinAttempts || 0) + 1;
    if (delivery.pinAttempts >= MAX_PIN_ATTEMPTS) {
      delivery.pinLockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000);
    }
    await delivery.save();
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid handover PIN. ${Math.max(0, MAX_PIN_ATTEMPTS - delivery.pinAttempts)} attempts remaining.`,
    );
  }

  // Leg completed — claimed atomically so a double tap cannot complete it twice
  const delivered = await Delivery.findOneAndUpdate(
    {
      _id: delivery._id,
      riderId: rider._id,
      status: { $in: [DeliveryStatus.picked_up, DeliveryStatus.in_transit] },
    },
    {
      $set: {
        status: DeliveryStatus.delivered,
        deliveredAt: new Date(),
        pinAttempts: 0,
        ...(proofPhoto && { proofPhoto }),
      },
      $unset: { pinLockedUntil: 1 },
    },
    { returnDocument: "after" },
  );
  if (!delivered) {
    throw new AppError(httpStatus.CONFLICT, "This delivery was already updated. Please refresh.");
  }

  // Update rider stats & active delivery count
  await RiderProfile.updateOne(
    { _id: rider._id },
    { $inc: { "stats.totalDeliveries": 1, "stats.completed": 1 } },
  );
  await RiderProfile.updateOne(
    { _id: rider._id, activeDeliveryCount: { $gt: 0 } },
    { $inc: { activeDeliveryCount: -1 } },
  );

  const subOrder = await SubOrder.findById(delivery.subOrderId);
  if (!subOrder) throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");

  // If COD collected by rider
  if (delivery.collectsCash) {
    subOrder.codCollectedBy = rider._id as Types.ObjectId;
    subOrder.codCollectedAt = new Date();
  }

  // Check if there is a next leg
  const nextLeg = await Delivery.findOne({
    subOrderId: subOrder._id,
    legNumber: delivery.legNumber + 1,
  });

  if (nextLeg) {
    subOrder.currentLegId = nextLeg._id as Types.ObjectId;
    subOrder.timeline.push({
      status: "leg_completed",
      note: `Leg #${delivery.legNumber} delivered to ${delivery.toName}`,
      byUserId: new Types.ObjectId(riderUserId),
      at: new Date(),
    });
    await subOrder.save();
  } else {
    // Final leg completed -> SubOrder is delivered!
    subOrder.status = SubOrderStatus.delivered;
    subOrder.deliveredAt = new Date();
    subOrder.timeline.push({
      status: "delivered",
      note: `Order successfully delivered to customer by partner`,
      byUserId: new Types.ObjectId(riderUserId),
      at: new Date(),
    });
    await subOrder.save();

    // Release escrow for sub-order (vendor earnings + partner delivery fee)
    await WalletServices.releaseEscrowForSubOrder(
      String(subOrder._id),
      riderUserId,
    );

    // Parent order: completed (or partially cancelled) once every sub-order is finished
    const orderStatus = await syncOrderStatus(subOrder.orderId);
    if (orderStatus !== OrderStatus.active) {
      await Order.updateOne(
        { _id: subOrder.orderId, paymentMethod: PaymentMethod.cod },
        { paymentStatus: PaymentStatus.paid },
      );
    }

    Notify.orderDelivered(subOrder);
  }

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.delivered,
    proofPhoto: delivered.proofPhoto,
  });

  return delivered;
};

export {
  goingToPickup,
  verifyPickup,
  verifyHandover,
};

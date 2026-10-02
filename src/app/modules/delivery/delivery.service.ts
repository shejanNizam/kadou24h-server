import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { Types } from "mongoose";
import { configs } from "../../config";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { emitToDelivery, emitToUser } from "../../../socket/socket";
import { calculateDistanceKm } from "../delivery_rate/delivery_rate.service";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { DeliveryType, OrderStatus, SubOrderStatus } from "../order/order.interface";
import { ApprovalStatus } from "../profile_common/profile.common";
import { PartnerType } from "../rider_profile/rider_profile.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { TransitStation } from "../transit_station/transit_station.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { LinkStatus } from "../vendor_rider_link/vendor_rider_link.interface";
import { VendorRiderLink } from "../vendor_rider_link/vendor_rider_link.model";
import {
  DeliveryStatus,
  EndpointKind,
  IAvailableRider,
  IDelivery,
  LegType,
} from "./delivery.interface";
import { Delivery } from "./delivery.model";

/**
 * Generates a random 4-digit PIN and its bcrypt hash.
 */
const generatePinPair = async (): Promise<{ pin: string; hash: string }> => {
  const pin = Math.floor(1000 + Math.random() * 9000).toString();
  const saltRounds = Number(configs.bcrypt_salt_round) || 10;
  const hash = await bcrypt.hash(pin, saltRounds);
  return { pin, hash };
};

/**
 * Creates the delivery legs for a sub-order based on order delivery type.
 * Local = 1 leg; Intercity = 3 legs; Station Pickup = 2 legs.
 */
const createDeliveryLegsForSubOrder = async (
  subOrderId: string,
): Promise<IDelivery[]> => {
  const subOrder = await SubOrder.findById(subOrderId);
  if (!subOrder) throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");

  const order = await Order.findById(subOrder.orderId);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, "Parent order not found");

  const vendor = await VendorProfile.findById(subOrder.vendorId);
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Vendor profile not found");

  // Check if legs already exist
  const existingLegs = await Delivery.find({ subOrderId: subOrder._id }).sort({
    legNumber: 1,
  });
  if (existingLegs.length > 0) return existingLegs;

  const isCod = order.paymentMethod === "cod";
  const vendorCoords: [number, number] = vendor.address?.location?.coordinates || [
    -13.6785, 9.537,
  ];
  const customerCoords: [number, number] = order.addressSnapshot.location.coordinates;

  const createdLegs: IDelivery[] = [];

  if (order.deliveryType === DeliveryType.local) {
    // 1 Local Leg
    const pickupPin = await generatePinPair();
    const handoverPin = await generatePinPair();

    const leg = await Delivery.create({
      subOrderId: subOrder._id,
      orderId: order._id,
      legNumber: 1,
      legType: LegType.local,
      fromKind: EndpointKind.vendor,
      fromRefId: vendor._id,
      fromName: vendor.storeName || "Store",
      fromLocation: { type: "Point", coordinates: vendorCoords },
      fromAddressText: vendor.address?.text || vendor.address?.city || "",
      fromPhone: vendor.businessPhone,
      toKind: EndpointKind.customer,
      toRefId: order.customerId,
      toName: order.addressSnapshot.fullName,
      toLocation: { type: "Point", coordinates: customerCoords },
      toAddressText: `${order.addressSnapshot.city}, ${order.addressSnapshot.neighborhood || order.addressSnapshot.landmark || ""}`,
      toPhone: order.addressSnapshot.phone,
      status: DeliveryStatus.pending_assignment,
      fee: subOrder.deliveryFee,
      pickupPin: pickupPin.pin,
      pickupPinHash: pickupPin.hash,
      handoverPin: handoverPin.pin,
      handoverPinHash: handoverPin.hash,
      collectsCash: isCod,
    });

    createdLegs.push(leg);
    subOrder.currentLegId = leg._id as Types.ObjectId;
    await subOrder.save();
  } else if (order.deliveryType === DeliveryType.intercity) {
    // 3 Legs: first_mile (moto) -> line_haul (bus) -> last_mile (moto)
    const departureStation = await TransitStation.findOne({ isActive: true });
    const destinationStation = order.destinationStationId
      ? await TransitStation.findById(order.destinationStationId)
      : null;

    const depStationCoords: [number, number] = departureStation?.location?.coordinates || [
      -13.65, 9.55,
    ];
    const destStationCoords: [number, number] = destinationStation?.location?.coordinates || [
      -12.28, 11.31,
    ];

    const pin1Pickup = await generatePinPair();
    const pin1Handover = await generatePinPair();
    const pin2Pickup = await generatePinPair();
    const pin2Handover = await generatePinPair();
    const pin3Pickup = await generatePinPair();
    const pin3Handover = await generatePinPair();

    const firstMileFee = 10000;
    const lastMileFee = 10000;
    const lineHaulFee = Math.max(0, subOrder.deliveryFee - firstMileFee - lastMileFee);

    // Leg 1: Vendor -> Departure Station
    const leg1 = await Delivery.create({
      subOrderId: subOrder._id,
      orderId: order._id,
      legNumber: 1,
      legType: LegType.first_mile,
      fromKind: EndpointKind.vendor,
      fromRefId: vendor._id,
      fromName: vendor.storeName || "Store",
      fromLocation: { type: "Point", coordinates: vendorCoords },
      fromAddressText: vendor.address?.text || "",
      fromPhone: vendor.businessPhone,
      toKind: EndpointKind.station,
      toRefId: departureStation?._id,
      toName: departureStation?.name || "Departure Bus Station",
      toLocation: { type: "Point", coordinates: depStationCoords },
      toAddressText: departureStation?.city || "",
      status: DeliveryStatus.pending_assignment,
      fee: firstMileFee,
      pickupPin: pin1Pickup.pin,
      pickupPinHash: pin1Pickup.hash,
      handoverPin: pin1Handover.pin,
      handoverPinHash: pin1Handover.hash,
      collectsCash: false,
    });

    // Leg 2: Departure Station -> Destination Station
    const leg2 = await Delivery.create({
      subOrderId: subOrder._id,
      orderId: order._id,
      legNumber: 2,
      legType: LegType.line_haul,
      fromKind: EndpointKind.station,
      fromRefId: departureStation?._id,
      fromName: departureStation?.name || "Departure Station",
      fromLocation: { type: "Point", coordinates: depStationCoords },
      toKind: EndpointKind.station,
      toRefId: destinationStation?._id,
      toName: destinationStation?.name || "Destination Station",
      toLocation: { type: "Point", coordinates: destStationCoords },
      status: DeliveryStatus.pending_assignment,
      fee: lineHaulFee,
      pickupPin: pin2Pickup.pin,
      pickupPinHash: pin2Pickup.hash,
      handoverPin: pin2Handover.pin,
      handoverPinHash: pin2Handover.hash,
      collectsCash: false,
    });

    // Leg 3: Destination Station -> Customer
    const leg3 = await Delivery.create({
      subOrderId: subOrder._id,
      orderId: order._id,
      legNumber: 3,
      legType: LegType.last_mile,
      fromKind: EndpointKind.station,
      fromRefId: destinationStation?._id,
      fromName: destinationStation?.name || "Destination Station",
      fromLocation: { type: "Point", coordinates: destStationCoords },
      toKind: EndpointKind.customer,
      toRefId: order.customerId,
      toName: order.addressSnapshot.fullName,
      toLocation: { type: "Point", coordinates: customerCoords },
      toAddressText: `${order.addressSnapshot.city}, ${order.addressSnapshot.neighborhood || ""}`,
      toPhone: order.addressSnapshot.phone,
      status: DeliveryStatus.pending_assignment,
      fee: lastMileFee,
      pickupPin: pin3Pickup.pin,
      pickupPinHash: pin3Pickup.hash,
      handoverPin: pin3Handover.pin,
      handoverPinHash: pin3Handover.hash,
      collectsCash: isCod,
    });

    createdLegs.push(leg1, leg2, leg3);
    subOrder.currentLegId = leg1._id as Types.ObjectId;
    await subOrder.save();
  } else if (order.deliveryType === DeliveryType.station_pickup) {
    // 2 Legs: first_mile -> line_haul (customer collects at station)
    const departureStation = await TransitStation.findOne({ isActive: true });
    const destinationStation = order.destinationStationId
      ? await TransitStation.findById(order.destinationStationId)
      : null;

    const depStationCoords: [number, number] = departureStation?.location?.coordinates || [
      -13.65, 9.55,
    ];
    const destStationCoords: [number, number] = destinationStation?.location?.coordinates || [
      -12.28, 11.31,
    ];

    const pin1Pickup = await generatePinPair();
    const pin1Handover = await generatePinPair();
    const pin2Pickup = await generatePinPair();
    const pin2Handover = await generatePinPair();

    const leg1 = await Delivery.create({
      subOrderId: subOrder._id,
      orderId: order._id,
      legNumber: 1,
      legType: LegType.first_mile,
      fromKind: EndpointKind.vendor,
      fromRefId: vendor._id,
      fromName: vendor.storeName || "Store",
      fromLocation: { type: "Point", coordinates: vendorCoords },
      toKind: EndpointKind.station,
      toRefId: departureStation?._id,
      toName: departureStation?.name || "Departure Station",
      toLocation: { type: "Point", coordinates: depStationCoords },
      status: DeliveryStatus.pending_assignment,
      fee: 10000,
      pickupPin: pin1Pickup.pin,
      pickupPinHash: pin1Pickup.hash,
      handoverPin: pin1Handover.pin,
      handoverPinHash: pin1Handover.hash,
      collectsCash: false,
    });

    const leg2 = await Delivery.create({
      subOrderId: subOrder._id,
      orderId: order._id,
      legNumber: 2,
      legType: LegType.line_haul,
      fromKind: EndpointKind.station,
      fromRefId: departureStation?._id,
      fromName: departureStation?.name || "Departure Station",
      fromLocation: { type: "Point", coordinates: depStationCoords },
      toKind: EndpointKind.station,
      toRefId: destinationStation?._id,
      toName: destinationStation?.name || "Destination Station",
      toLocation: { type: "Point", coordinates: destStationCoords },
      status: DeliveryStatus.pending_assignment,
      fee: Math.max(0, subOrder.deliveryFee - 10000),
      pickupPin: pin2Pickup.pin,
      pickupPinHash: pin2Pickup.hash,
      handoverPin: pin2Handover.pin,
      handoverPinHash: pin2Handover.hash,
      collectsCash: isCod,
    });

    createdLegs.push(leg1, leg2);
    subOrder.currentLegId = leg1._id as Types.ObjectId;
    await subOrder.save();
  }

  return createdLegs;
};

/**
 * Lists available online delivery partners for a delivery leg.
 * Prioritizes active linked riders, then sorts nearby online riders by distance.
 */
const getAvailableRiders = async (
  vendorUserId: string,
  deliveryId: string,
): Promise<IAvailableRider[]> => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found");

  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new AppError(httpStatus.NOT_FOUND, "Delivery leg not found");

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
  }).populate("userId", "name phone avatar");

  const originCoords = delivery.fromLocation.coordinates;

  const ridersList: IAvailableRider[] = onlineRiders.map((rider) => {
    const isLinked = linkedRiderIds.has(String(rider._id));
    const riderCoords = rider.lastLocation?.coordinates;
    const distanceKm = riderCoords
      ? calculateDistanceKm(originCoords, riderCoords)
      : undefined;

    const user: any = rider.userId;
    return {
      _id: String(rider._id),
      userId: String(rider.userId?._id || rider.userId),
      name: user?.name || "Rider",
      phone: user?.phone,
      avatar: user?.avatar?.url,
      partnerType: rider.partnerType || "moto",
      vehicleType: rider.vehicle?.type || "motorbike",
      vehicleBrand: rider.vehicle?.brand,
      plateNumber: rider.vehicle?.plateNumber,
      isLinked,
      ratingAvg: rider.stats?.ratingAvg || 0,
      totalDeliveries: rider.stats?.totalDeliveries || 0,
      activeDeliveryCount: rider.activeDeliveryCount || 0,
      distanceKm,
      currentLocation: riderCoords,
    };
  });

  // Sort: linked riders first, then by shortest distance
  ridersList.sort((a, b) => {
    if (a.isLinked && !b.isLinked) return -1;
    if (!a.isLinked && b.isLinked) return 1;
    if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
      return a.distanceKm - b.distanceKm;
    }
    return 0;
  });

  return ridersList;
};

/**
 * Assigns a delivery leg to a rider.
 */
const assignRider = async (
  actorUserId: string,
  deliveryId: string,
  riderId: string,
) => {
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new AppError(httpStatus.NOT_FOUND, "Delivery leg not found");

  if (
    ![DeliveryStatus.pending_assignment, DeliveryStatus.declined].includes(
      delivery.status,
    )
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot assign rider while delivery is "${delivery.status}"`,
    );
  }

  const rider = await RiderProfile.findOne({
    _id: riderId,
    approvalStatus: ApprovalStatus.approved,
  });
  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "Delivery partner not found");

  delivery.riderId = rider._id as Types.ObjectId;
  delivery.assignedBy = new Types.ObjectId(actorUserId);
  delivery.assignedAt = new Date();
  delivery.status = DeliveryStatus.assigned;
  await delivery.save();

  // Update sub-order current rider
  await SubOrder.findByIdAndUpdate(delivery.subOrderId, {
    currentRiderId: rider._id,
  });

  // Real-time notifications
  emitToUser(String(rider.userId), "delivery:assigned", {
    deliveryId: delivery._id,
    subOrderId: delivery.subOrderId,
    legType: delivery.legType,
    fee: delivery.fee,
    fromName: delivery.fromName,
    toName: delivery.toName,
    collectsCash: delivery.collectsCash,
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
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const delivery = await Delivery.findOne({
    _id: deliveryId,
    riderId: rider._id,
    status: DeliveryStatus.assigned,
  });

  if (!delivery) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "No assigned delivery found awaiting your acceptance",
    );
  }

  // If COD, check rider cash limits
  if (delivery.collectsCash) {
    const settings = await SettingsServices.getSettings();
    const maxCash = rider.cashLimit || settings.riderCashLimitDefault || 500000;
    // (In Step 6 wallet cashOwed is tracked; safety boundary verified)
    if (delivery.fee > maxCash) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Cash on delivery amount exceeds authorized partner limit",
      );
    }
  }

  delivery.status = DeliveryStatus.accepted;
  delivery.acceptedAt = new Date();
  await delivery.save();

  // Increment active deliveries on rider
  rider.activeDeliveryCount = (rider.activeDeliveryCount || 0) + 1;
  await rider.save();

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

  return delivery;
};

/**
 * Rider declines assigned job; reverts leg to pending_assignment.
 */
const declineDelivery = async (
  riderUserId: string,
  deliveryId: string,
  reason: string,
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const delivery = await Delivery.findOne({
    _id: deliveryId,
    riderId: rider._id,
    status: DeliveryStatus.assigned,
  });

  if (!delivery) {
    throw new AppError(httpStatus.NOT_FOUND, "Assigned delivery not found");
  }

  delivery.status = DeliveryStatus.pending_assignment;
  delivery.declineReason = reason;
  delivery.riderId = undefined;
  await delivery.save();

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
    }
  }

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.pending_assignment,
  });

  return delivery;
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
  });

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

  // Check lockout
  if (delivery.pinLockedUntil && delivery.pinLockedUntil > new Date()) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "PIN verification locked due to too many failed attempts. Try again later.",
    );
  }

  const isMatch = await bcrypt.compare(pin, delivery.pickupPinHash);

  if (!isMatch) {
    delivery.pinAttempts = (delivery.pinAttempts || 0) + 1;
    if (delivery.pinAttempts >= 5) {
      delivery.pinLockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    }
    await delivery.save();
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid pickup PIN. ${Math.max(0, 5 - delivery.pinAttempts)} attempts remaining.`,
    );
  }

  // Match success!
  delivery.status = DeliveryStatus.picked_up;
  delivery.pickedUpAt = new Date();
  delivery.pinAttempts = 0;
  delivery.pinLockedUntil = undefined;
  await delivery.save();

  // Progress sub-order to in_delivery
  await SubOrder.findByIdAndUpdate(delivery.subOrderId, {
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

  return delivery;
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
  });

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

  // Check lockout
  if (delivery.pinLockedUntil && delivery.pinLockedUntil > new Date()) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "PIN verification locked due to too many failed attempts. Try again later.",
    );
  }

  const isMatch = await bcrypt.compare(pin, delivery.handoverPinHash);

  if (!isMatch) {
    delivery.pinAttempts = (delivery.pinAttempts || 0) + 1;
    if (delivery.pinAttempts >= 5) {
      delivery.pinLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    await delivery.save();
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid handover PIN. ${Math.max(0, 5 - delivery.pinAttempts)} attempts remaining.`,
    );
  }

  // Leg completed successfully!
  delivery.status = DeliveryStatus.delivered;
  delivery.deliveredAt = new Date();
  delivery.pinAttempts = 0;
  delivery.pinLockedUntil = undefined;
  if (proofPhoto) delivery.proofPhoto = proofPhoto;
  await delivery.save();

  // Update rider stats & active delivery count
  rider.activeDeliveryCount = Math.max(0, (rider.activeDeliveryCount || 1) - 1);
  rider.stats = {
    ...rider.stats,
    totalDeliveries: (rider.stats?.totalDeliveries || 0) + 1,
    completed: (rider.stats?.completed || 0) + 1,
  };
  await rider.save();

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
    subOrder.timeline.push({
      status: "delivered",
      note: `Order successfully delivered to customer by partner`,
      byUserId: new Types.ObjectId(riderUserId),
      at: new Date(),
    });
    await subOrder.save();

    // Check parent Order
    const allSubOrders = await SubOrder.find({ orderId: subOrder.orderId });
    const allDelivered = allSubOrders.every(
      (so) => so.status === SubOrderStatus.delivered,
    );
    if (allDelivered) {
      await Order.findByIdAndUpdate(subOrder.orderId, {
        status: OrderStatus.completed,
      });
    }
  }

  emitToDelivery(String(delivery._id), "delivery:status_changed", {
    status: DeliveryStatus.delivered,
    proofPhoto: delivery.proofPhoto,
  });

  return delivery;
};

/**
 * Returns tracking details for customer, vendor, or rider with secure PIN exposure.
 */
const trackDelivery = async (
  userId: string,
  deliveryId: string,
) => {
  const delivery = await Delivery.findById(deliveryId)
    .populate("riderId", "partnerType vehicle stats lastLocation lastLocationAt")
    .populate("subOrderId", "subOrderNumber status total")
    .populate("orderId", "orderNumber addressSnapshot paymentMethod");

  if (!delivery) throw new AppError(httpStatus.NOT_FOUND, "Delivery not found");

  const subOrder = await SubOrder.findById(delivery.subOrderId);
  const order = await Order.findById(delivery.orderId);
  const vendor = subOrder ? await VendorProfile.findById(subOrder.vendorId) : null;
  const riderProfile = await RiderProfile.findOne({ userId });

  // Security: only giver gets pickupPin, only receiver gets handoverPin
  const isGiver =
    String(vendor?.userId) === userId ||
    (delivery.fromKind === EndpointKind.station && String(delivery.fromRefId) === userId);

  const isReceiver =
    String(order?.customerId) === userId ||
    (delivery.toKind === EndpointKind.station && String(delivery.toRefId) === userId);

  const isRider = String(riderProfile?._id) === String(delivery.riderId);

  const deliveryObj = delivery.toObject();

  // Hide PINs from anyone who is not the giver/receiver
  if (!isGiver) delete (deliveryObj as any).pickupPin;
  if (!isReceiver) delete (deliveryObj as any).handoverPin;

  // Never expose bcrypt hashes to the API
  delete (deliveryObj as any).pickupPinHash;
  delete (deliveryObj as any).handoverPinHash;

  return {
    ...deliveryObj,
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
    const obj = d.toObject();
    // Do not leak secret PINs to rider
    delete (obj as any).pickupPin;
    delete (obj as any).handoverPin;
    delete (obj as any).pickupPinHash;
    delete (obj as any).handoverPinHash;
    return obj;
  });
};

export const DeliveryServices = {
  createDeliveryLegsForSubOrder,
  getAvailableRiders,
  assignRider,
  acceptDelivery,
  declineDelivery,
  goingToPickup,
  verifyPickup,
  verifyHandover,
  trackDelivery,
  updateRiderLocation,
  toggleRiderOnline,
  getMyDeliveries,
};

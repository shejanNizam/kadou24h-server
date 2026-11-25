/**
 * Creates the delivery legs of a sub-order (1 local, 2–3 intercity) with their PINs.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { DeliveryType } from "../order/order.interface";
import { TransitStation } from "../transit_station/transit_station.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import {
  DeliveryStatus,
  EndpointKind,
  IDelivery,
  LegType,
} from "./delivery.interface";
import { Delivery } from "./delivery.model";
import { generatePinPair } from "./delivery.utils";
import { SettingsServices } from "../settings/settings.service";
import type { ISubOrder } from "../order/order.interface";

/**
 * What each partner earns on another-city delivery: fixed at checkout (client, 2026-11-25).
 * Older sub-orders: today's moto amounts, the bus gets the rest; the sum is always what
 * the customer paid for delivery.
 */
const legFeesOf = async (subOrder: ISubOrder, stationPickup: boolean) => {
  if (subOrder.legFees) return subOrder.legFees;
  const { intercity } = await SettingsServices.getSettings();
  const firstMile = Math.min(intercity?.firstMileFee ?? 10000, subOrder.deliveryFee);
  const lastMile = stationPickup ? 0 : Math.min(intercity?.lastMileFee ?? 10000, subOrder.deliveryFee - firstMile);
  return { firstMile, lastMile, lineHaul: Math.max(0, subOrder.deliveryFee - firstMile - lastMile) };
};

/**
 * Creates the delivery legs for a sub-order based on order delivery type.
 * Local = 1 leg; Intercity = 3 legs; Station Pickup = 2 legs.
 */
const createDeliveryLegsForSubOrder = async (
  subOrderId: string,
): Promise<IDelivery[]> => {
  const subOrder = await SubOrder.findById(subOrderId);
  if (!subOrder) throw new AppError(httpStatus.NOT_FOUND, "SUB_ORDER_NOT_FOUND");

  const order = await Order.findById(subOrder.orderId);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, "ORDER_NOT_FOUND");

  const vendor = await VendorProfile.findById(subOrder.vendorId);
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "VENDOR_PROFILE_NOT_FOUND");

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
    let departureStation = null;
    if (vendorCoords) {
      departureStation = await TransitStation.findOne({
        isActive: true,
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: vendorCoords,
            },
          },
        },
      });
    }
    if (!departureStation) {
      departureStation = await TransitStation.findOne({ isActive: true });
    }
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

    const fees = await legFeesOf(subOrder, false);

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
      fee: fees.firstMile,
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
      fee: fees.lineHaul,
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
      fee: fees.lastMile,
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
    let departureStation = null;
    if (vendorCoords) {
      departureStation = await TransitStation.findOne({
        isActive: true,
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: vendorCoords,
            },
          },
        },
      });
    }
    if (!departureStation) {
      departureStation = await TransitStation.findOne({ isActive: true });
    }
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
    const pickupFees = await legFeesOf(subOrder, true);

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
      fee: pickupFees.firstMile,
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
      fee: pickupFees.lineHaul,
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

export {
  createDeliveryLegsForSubOrder,
};

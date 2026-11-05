/**
 * Checkout: price calculation and order placement (with rollback).
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { logger } from "../../utils/logger";
import { Notify } from "../notification/notification.events";
import { Cart } from "../cart/cart.model";
import { CounterServices } from "../counter/counter.service";
import { CouponServices, normalizeCode } from "../coupon/coupon.service";
import { codCashBase } from "./order.utils";
import { DeliveryRateType, DeliveryVehicleType } from "../delivery_rate/delivery_rate.interface";
import { DeliveryRateServices } from "../delivery_rate/delivery_rate.service";
import { Product } from "../product/product.model";
import { IProduct, ProductApprovalStatus } from "../product/product.interface";
import { ApprovalStatus } from "../profile_common/profile.common";
import { DeliveryServices } from "../delivery/delivery.service";
import { Delivery } from "../delivery/delivery.model";
import { SettingsServices } from "../settings/settings.service";
import { TransitStation } from "../transit_station/transit_station.model";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import {
  DeliveryType,
  IAddressSnapshot,
  IAddressSnapshotInput,
  ICheckoutItemInput,
  ICheckoutSummaryInput,
  ISubOrder,
  ISubOrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SettlementStatus,
  SubOrderStatus,
} from "./order.interface";
import { Order } from "./order.model";
import { SubOrder } from "./sub_order.model";
import { TransactionType, WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";

/**
 * Resolves address snapshot from direct snapshot, saved address ID, or user default address.
 */
const resolveAddress = async (
  customerId: string,
  input: {
    addressId?: string;
    addressSnapshot?: IAddressSnapshotInput;
  },
): Promise<IAddressSnapshot> => {
  if (input.addressSnapshot) {
    const loc = input.addressSnapshot.location;
    return {
      fullName: input.addressSnapshot.fullName,
      phone: input.addressSnapshot.phone,
      city: input.addressSnapshot.city,
      commune: input.addressSnapshot.commune,
      neighborhood: input.addressSnapshot.neighborhood,
      landmark: input.addressSnapshot.landmark,
      directions: input.addressSnapshot.directions,
      location: {
        type: "Point",
        coordinates: [loc.lng, loc.lat],
      },
      placePhoto: input.addressSnapshot.placePhoto,
    };
  }

  const user = await User.findById(customerId);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");

  let address;
  if (input.addressId) {
    address = user.addresses?.find(
      (a) => String(a._id) === String(input.addressId),
    );
  } else {
    address =
      user.addresses?.find((a) => a.isDefault) || user.addresses?.[0];
  }

  if (!address) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "ADDRESS_REQUIRED",
    );
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

// Moto legs to/from the bus stations (the delivery legs use the same amounts)
/** Online orders must be paid within this window, or they are cancelled (stock released). */
export const PAYMENT_WINDOW_MINUTES = 30;

const FIRST_MILE_FEE = 10000;
const LAST_MILE_FEE = 10000;

interface IStationRoute {
  fromStationName: string;
  fromCity: string;
  toStationName: string;
  toCity: string;
  estimatedHours?: number;
}

/**
 * Departure = the active station nearest to the store; destination = the buyer's choice.
 */
const resolveStationRoute = async (
  vendorCoords: [number, number],
  destinationStationId?: string,
) => {
  if (!destinationStationId) {
    throw new AppError(httpStatus.BAD_REQUEST, "STATION_REQUIRED");
  }
  const to = await TransitStation.findOne({ _id: destinationStationId, isActive: true });
  if (!to) {
    throw new AppError(httpStatus.BAD_REQUEST, "STATION_UNAVAILABLE");
  }
  const from =
    (await TransitStation.findOne({
      isActive: true,
      location: { $near: { $geometry: { type: "Point", coordinates: vendorCoords } } },
    })) ?? (await TransitStation.findOne({ isActive: true }));
  if (!from) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "NO_TRANSIT_STATIONS",
    );
  }
  if (String(from._id) === String(to._id)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "STATION_SAME_CITY",
    );
  }
  return { from, to };
};

/**
 * Calculates checkout pricing, delivery fees, platform fee, and splits by vendor.
 */
const calculateCheckout = async (
  customerId: string,
  payload: ICheckoutSummaryInput,
  /** Placing the order: a bad promo code is an error (the summary only reports it) */
  opts: { strictCoupon?: boolean } = {},
) => {
  const addressSnapshot = await resolveAddress(customerId, {
    addressId: payload.addressId,
    addressSnapshot: payload.addressSnapshot,
  });

  // Determine items to checkout
  let itemInputs: ICheckoutItemInput[];
  if (payload.items && payload.items.length > 0) {
    itemInputs = payload.items;
  } else {
    const cart = await Cart.findOne({ userId: customerId });
    if (!cart || cart.items.length === 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "CART_EMPTY",
      );
    }
    itemInputs = cart.items.map((i) => ({
      productId: String(i.productId),
      qty: i.qty,
    }));
  }

  // Fetch products
  const productIds = itemInputs.map((i) => i.productId);
  const products = await Product.find({
    _id: { $in: productIds },
    isDeleted: false,
  });
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  // Validate stock and status
  for (const input of itemInputs) {
    const product = productMap.get(input.productId);
    if (!product) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        "PRODUCT_NOT_FOUND",
      );
    }
    if (product.approvalStatus !== ProductApprovalStatus.approved) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "PRODUCT_NOT_APPROVED", { name: product.name },
      );
    }
    if (!product.isAvailable) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "PRODUCT_UNAVAILABLE", { name: product.name },
      );
    }
    if (product.stockQty < input.qty) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "INSUFFICIENT_STOCK", { name: product.name, available: product.stockQty, requested: input.qty },
      );
    }
  }

  // Group items by vendor
  const vendorMap = new Map<string, { product: IProduct; qty: number }[]>();
  for (const input of itemInputs) {
    const product = productMap.get(input.productId)!;
    const vId = String(product.vendorId);
    if (!vendorMap.has(vId)) {
      vendorMap.set(vId, []);
    }
    vendorMap.get(vId)!.push({ product, qty: input.qty });
  }

  // Fetch vendors
  const vendorProfiles = await VendorProfile.find({
    _id: { $in: Array.from(vendorMap.keys()) },
  });
  const vendorProfileMap = new Map(
    vendorProfiles.map((v) => [String(v._id), v]),
  );

  const settings = await SettingsServices.getSettings();
  const platformFee = Math.max(settings.platformFee ?? 1000, 1000); // minimum 1000 GNF
  const commissionRate = settings.commission?.rate ?? 10;
  const commissionMin = settings.commission?.min ?? 1000;
  const taxRate = settings.taxRate ?? 0;

  const vendorSplits: Array<{
    vendorId: string;
    storeName: string;
    vendorLocation?: [number, number];
    items: ISubOrderItem[];
    subtotal: number;
    deliveryFee: number;
    deliveryDistanceKm?: number;
    stationRoute?: IStationRoute;
    commissionRate: number;
    commissionAmount: number;
    vendorEarning: number;
    /** This store's part of the promo discount (paid by Kadou24h, not the store) */
    discountShare: number;
    total: number;
  }> = [];

  let overallSubtotal = 0;
  let overallDeliveryFee = 0;

  for (const [vendorId, itemsList] of vendorMap.entries()) {
    const vendorProfile = vendorProfileMap.get(vendorId);
    const storeName = vendorProfile?.storeName || "Vendor";

    if (!vendorProfile) {
      throw new AppError(httpStatus.NOT_FOUND, "STORE_NOT_FOUND");
    }

    if (vendorProfile.approvalStatus !== ApprovalStatus.approved) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "STORE_NOT_APPROVED", { store: storeName },
      );
    }

    if (vendorProfile.isOpen === false) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "STORE_CLOSED", { store: storeName },
      );
    }

    if (String(vendorProfile.userId) === customerId) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "OWN_STORE_PURCHASE", { store: storeName },
      );
    }

    let vendorSubtotal = 0;
    const subOrderItems: ISubOrderItem[] = [];

    for (const { product, qty } of itemsList) {
      const unitPrice = product.discountPrice ?? product.price;
      const lineTotal = unitPrice * qty;
      vendorSubtotal += lineTotal;

      subOrderItems.push({
        productId: product._id,
        name: product.name,
        image: product.images?.[0]?.url,
        unitPrice,
        qty,
        lineTotal,
        removed: false,
      });
    }

    // Calculate delivery fee for this vendor
    let vendorDeliveryFee = 0;
    let distanceKm: number | undefined;
    let stationRoute: IStationRoute | undefined;

    if (payload.deliveryType === DeliveryType.local) {
      const vendorCoords: [number, number] = vendorProfile?.address?.location
        ?.coordinates || [-13.6785, 9.537]; // fallback Conakry
      const customerCoords = addressSnapshot.location.coordinates;

      const rateResult = await DeliveryRateServices.calculateDeliveryFee({
        type: DeliveryRateType.local,
        vendorLocation: vendorCoords,
        customerLocation: customerCoords,
        city: addressSnapshot.city,
        vehicleType: DeliveryVehicleType.motorbike,
      });
      vendorDeliveryFee = rateResult.fee;
      distanceKm = rateResult.distanceKm;
    } else {
      // intercity (moto → bus → moto) and station_pickup (moto → bus, the buyer
      // collects at the destination station) both ride the station-to-station rate
      const vendorCoords: [number, number] = vendorProfile?.address?.location
        ?.coordinates || [-13.6785, 9.537];
      const route = await resolveStationRoute(vendorCoords, payload.destinationStationId);

      const rateResult = await DeliveryRateServices.calculateDeliveryFee({
        type: DeliveryRateType.intercity,
        fromStationId: String(route.from._id),
        toStationId: String(route.to._id),
      });
      // Pickup at the station has no last moto leg
      vendorDeliveryFee =
        payload.deliveryType === DeliveryType.station_pickup
          ? Math.max(rateResult.fee - LAST_MILE_FEE, FIRST_MILE_FEE)
          : rateResult.fee;
      stationRoute = {
        fromStationName: route.from.name,
        fromCity: route.from.city,
        toStationName: route.to.name,
        toCity: route.to.city,
        estimatedHours: rateResult.estimatedHours,
      };
    }

    // Safe commission: never exceeds 90% of subtotal so vendor earning is never negative
    const rawCommission = Math.round((commissionRate / 100) * vendorSubtotal);
    const cappedMin = Math.min(commissionMin, Math.round(vendorSubtotal * 0.9));
    const commissionAmount = Math.min(
      Math.max(rawCommission, cappedMin),
      Math.round(vendorSubtotal * 0.9),
    );
    const vendorEarning = Math.max(0, vendorSubtotal - commissionAmount);
    const vendorTotal = vendorSubtotal + vendorDeliveryFee;

    overallSubtotal += vendorSubtotal;
    overallDeliveryFee += vendorDeliveryFee;

    vendorSplits.push({
      vendorId,
      storeName,
      vendorLocation: vendorProfile?.address?.location?.coordinates,
      items: subOrderItems,
      subtotal: vendorSubtotal,
      deliveryFee: vendorDeliveryFee,
      deliveryDistanceKm: distanceKm,
      stationRoute,
      commissionRate,
      commissionAmount,
      vendorEarning,
      discountShare: 0,
      total: vendorTotal,
    });
  }

  // Promo code: Kadou24h pays the discount, so store earnings and commissions don't change
  let discount = 0;
  let appliedCoupon: Awaited<ReturnType<typeof CouponServices.evaluate>>["coupon"] | undefined;
  let coupon: { code: string; valid: boolean; discount: number; description?: string; message?: string } | undefined;
  if (payload.couponCode?.trim()) {
    try {
      const result = await CouponServices.evaluate(payload.couponCode, customerId, overallSubtotal);
      discount = result.discount;
      appliedCoupon = result.coupon;
      coupon = { code: result.coupon.code, valid: true, discount, description: result.coupon.description };
    } catch (error) {
      if (opts.strictCoupon || !(error instanceof AppError)) throw error;
      coupon = { code: normalizeCode(payload.couponCode), valid: false, discount: 0, message: error.message };
    }
  }
  // Spread over the stores by their share of the products (the last one takes the rounding)
  if (discount > 0) {
    let left = discount;
    vendorSplits.forEach((split, i) => {
      const share = i === vendorSplits.length - 1 ? left : Math.min(left, Math.round((discount * split.subtotal) / overallSubtotal));
      split.discountShare = share;
      split.total -= share;
      left -= share;
    });
  }

  const taxAmount = Math.round(overallSubtotal * (taxRate / 100));
  const total = overallSubtotal + overallDeliveryFee + taxAmount + platformFee - discount;

  // Cash on delivery (client, 2026-10-23): the service fee, tax and delivery fees are paid
  // online first, so Kadou24h and the riders are covered; each store's rider then collects
  // only its products (minus the promo share). A rider may carry at most
  // riderCashLimitDefault, so above it no rider could accept — those orders are paid online.
  const codLimit = settings.riderCashLimitDefault || 1_000_000;
  const codLargestStoreAmount = Math.max(0, ...vendorSplits.map((split) => codCashBase(split, true)));
  const isCod = payload.paymentMethod === PaymentMethod.cod;
  const upfront = platformFee + taxAmount + overallDeliveryFee;

  return {
    addressSnapshot,
    deliveryType: payload.deliveryType,
    destinationStationId: payload.destinationStationId,
    paymentMethod: payload.paymentMethod,
    cod: {
      allowed: codLargestStoreAmount <= codLimit,
      /** GNF — the most cash one rider may collect for one store's part */
      limit: codLimit,
    },
    pricing: {
      subtotal: overallSubtotal,
      deliveryFee: overallDeliveryFee,
      taxAmount,
      platformFee,
      discount,
      total,
      /** Paid online at checkout: everything, or (COD) the service fee, tax and delivery */
      payNow: isCod ? upfront : total,
      /** COD: the products, in cash to the riders */
      payOnDelivery: isCod ? total - upfront : 0,
    },
    /** The promo code typed: valid (with the discount) or why it can't be used */
    coupon,
    appliedCoupon,
    vendorSplits,
  };
};

/**
 * Creates parent order, vendor sub-orders, deducts stock, and clears cart.
 */
const placeOrder = async (
  customerId: string,
  payload: ICheckoutSummaryInput,
) => {
  const calculation = await calculateCheckout(customerId, payload, { strictCoupon: true });
  if (calculation.paymentMethod === PaymentMethod.cod && !calculation.cod.allowed) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "COD_LIMIT", { limit: calculation.cod.limit },
    );
  }

  // Everything done so far, so a failure at any step can be undone.
  // (Works on a standalone MongoDB; with a replica set this could become one transaction.)
  const done = {
    stock: [] as { productId: Types.ObjectId; qty: number }[],
    orderId: undefined as Types.ObjectId | undefined,
    subOrderIds: [] as Types.ObjectId[],
    escrowHeld: [] as { walletId: Types.ObjectId; amount: number; subOrderId: Types.ObjectId }[],
    coupon: undefined as { couponId: Types.ObjectId; redemptionId: Types.ObjectId; amount: number } | undefined,
  };

  const rollback = async () => {
    if (done.coupon) await CouponServices.undoRedemption(done.coupon);
    for (const hold of done.escrowHeld) {
      await WalletServices.recordTransaction({
        walletId: hold.walletId,
        type: TransactionType.earning_held_reversed,
        amount: hold.amount,
        subOrderId: hold.subOrderId,
        note: "Checkout failed — escrow hold undone",
        createdBy: customerId,
      });
    }
    if (done.subOrderIds.length) {
      await Delivery.deleteMany({ subOrderId: { $in: done.subOrderIds } });
      await SubOrder.deleteMany({ _id: { $in: done.subOrderIds } });
    }
    if (done.orderId) await Order.deleteOne({ _id: done.orderId });
    for (const item of done.stock) {
      await Product.updateOne(
        { _id: item.productId },
        { $inc: { stockQty: item.qty, soldCount: -item.qty } },
      );
    }
  };

  try {
    const result = await createOrderRecords(customerId, payload, calculation, done);
    // Only once everything succeeded — a rolled-back checkout notifies nobody.
    // Online orders reach the store once paid (OrderPaymentServices.confirmOrderPaid)
    for (const subOrder of result.subOrders) {
      if (subOrder.status === SubOrderStatus.new) Notify.orderPlaced(subOrder);
    }
    return result;
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      // Leave a loud trace: data needs manual repair
      logger.error("Checkout rollback failed", {
        customerId,
        done,
        error: rollbackError instanceof Error ? rollbackError.message : rollbackError,
      });
    }
    throw error;
  }
};

const createOrderRecords = async (
  customerId: string,
  payload: ICheckoutSummaryInput,
  calculation: Awaited<ReturnType<typeof calculateCheckout>>,
  done: {
    stock: { productId: Types.ObjectId; qty: number }[];
    orderId?: Types.ObjectId;
    subOrderIds: Types.ObjectId[];
    escrowHeld: { walletId: Types.ObjectId; amount: number; subOrderId: Types.ObjectId }[];
    coupon?: { couponId: Types.ObjectId; redemptionId: Types.ObjectId; amount: number };
  },
) => {
  // Atomically decrement stock
  for (const split of calculation.vendorSplits) {
    for (const item of split.items) {
      const updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          stockQty: { $gte: item.qty },
          isDeleted: false,
        },
        { $inc: { stockQty: -item.qty, soldCount: item.qty } },
      );

      if (!updated) {
        throw new AppError(
          httpStatus.CONFLICT,
          "OUT_OF_STOCK_DURING_CHECKOUT", { name: item.name },
        );
      }
      done.stock.push({ productId: item.productId, qty: item.qty });
    }
  }

  // Generate order number
  const orderNumber = await CounterServices.nextCode("order");
  // The store sees nothing until the online payment is confirmed (everything, or the COD
  // fees); the stock above stays reserved meanwhile
  const isCod = calculation.paymentMethod === PaymentMethod.cod;
  const payOnline = true;
  const placedAt = new Date();

  // Create parent order
  const order = await Order.create({
    orderNumber,
    customerId: new Types.ObjectId(customerId),
    addressSnapshot: calculation.addressSnapshot,
    deliveryType: calculation.deliveryType,
    destinationStationId: calculation.destinationStationId
      ? new Types.ObjectId(calculation.destinationStationId)
      : undefined,
    specialInstructions: payload.specialInstructions,
    paymentMethod: calculation.paymentMethod,
    paymentStatus: PaymentStatus.unpaid,
    subtotal: calculation.pricing.subtotal,
    deliveryFee: calculation.pricing.deliveryFee,
    taxAmount: calculation.pricing.taxAmount,
    platformFee: calculation.pricing.platformFee,
    discount: calculation.pricing.discount,
    ...(calculation.appliedCoupon && { couponCode: calculation.appliedCoupon.code }),
    total: calculation.pricing.total,
    status: OrderStatus.active,
    placedAt,
    ...(payOnline && { paymentDueAt: new Date(placedAt.getTime() + PAYMENT_WINDOW_MINUTES * 60_000) }),
    ...(isCod && { upfrontAmount: calculation.pricing.payNow }),
  });
  done.orderId = order._id as Types.ObjectId;

  // The customer's one use of the code (the total limit is checked atomically here)
  if (calculation.appliedCoupon && calculation.pricing.discount > 0) {
    done.coupon = await CouponServices.redeem(calculation.appliedCoupon, {
      customerId,
      orderId: order._id as Types.ObjectId,
      orderNumber,
      amount: calculation.pricing.discount,
    });
  }

  // Create sub-orders
  const createdSubOrders = [];
  let index = 1;

  for (const split of calculation.vendorSplits) {
    const subOrderNumber = `${orderNumber}-${index}`;
    index += 1;

    // COD: the rider collects the products only (the fees are paid online first)
    const codAmountToCollect = isCod ? codCashBase(split, true) : undefined;

    const subOrder = await SubOrder.create({
      orderId: order._id,
      subOrderNumber,
      customerId: new Types.ObjectId(customerId),
      vendorId: new Types.ObjectId(split.vendorId),
      items: split.items,
      timeline: [
        {
          status: "order_placed",
          note: isCod
            ? "Order placed by customer — waiting for the fees to be paid online"
            : "Order placed by customer — waiting for the online payment",
          byUserId: new Types.ObjectId(customerId),
          at: placedAt,
        },
      ],
      modifications: [],
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      discountShare: split.discountShare,
      total: split.total,
      commissionRate: split.commissionRate,
      commissionAmount: split.commissionAmount,
      vendorEarning: split.vendorEarning,
      status: payOnline ? SubOrderStatus.pending_payment : SubOrderStatus.new,
      settlement: SettlementStatus.held,
      codAmountToCollect,
    });

    createdSubOrders.push(subOrder);
    done.subOrderIds.push(subOrder._id as Types.ObjectId);

    // Online orders: escrow and delivery legs follow the payment (confirmOrderPaid)
    if (payOnline) continue;

    // Hold vendor earning in escrow — a failure here aborts the whole checkout
    const walletId = await holdEscrow(subOrder, customerId);
    done.escrowHeld.push({
      walletId,
      amount: split.vendorEarning,
      subOrderId: subOrder._id as Types.ObjectId,
    });

    await DeliveryServices.createDeliveryLegsForSubOrder(String(subOrder._id));
  }

  // Clear customer's cart
  await Cart.findOneAndUpdate(
    { userId: customerId },
    { $set: { items: [] } },
  );

  // Re-read: delivery-leg creation set currentLegId after the docs above were captured
  const subOrders = await SubOrder.find({ _id: { $in: createdSubOrders.map((s) => s._id) } });

  return {
    order,
    subOrders,
  };
};

/** Holds the store's earning in escrow: at checkout for COD, once paid for online orders. */
const holdEscrow = async (
  subOrder: Pick<ISubOrder, "_id" | "vendorId" | "vendorEarning" | "subOrderNumber">,
  actorId: string,
) => {
  const vendor = await VendorProfile.findById(subOrder.vendorId);
  if (!vendor) {
    throw new AppError(httpStatus.BAD_REQUEST, "STORE_NO_LONGER_AVAILABLE", { subOrderNumber: subOrder.subOrderNumber });
  }
  const vendorWallet = await WalletServices.ensureWallet(vendor.userId, WalletMode.vendor);
  await WalletServices.recordTransaction({
    walletId: vendorWallet._id,
    type: TransactionType.earning_held,
    amount: subOrder.vendorEarning,
    subOrderId: subOrder._id,
    note: `Escrow held for sub-order ${subOrder.subOrderNumber}`,
    createdBy: actorId,
  });
  return vendorWallet._id as Types.ObjectId;
};

export {
  holdEscrow,
  resolveAddress,
  calculateCheckout,
  placeOrder,
  createOrderRecords,
};

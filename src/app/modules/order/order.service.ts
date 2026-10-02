import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { IGeoPoint } from "../../interfaces/common.types";
import { Cart } from "../cart/cart.model";
import { CounterServices } from "../counter/counter.service";
import {
  DeliveryRateType,
  DeliveryVehicleType,
} from "../delivery_rate/delivery_rate.interface";
import { DeliveryRateServices } from "../delivery_rate/delivery_rate.service";
import { Product } from "../product/product.model";
import { ProductApprovalStatus } from "../product/product.interface";
import { DeliveryServices } from "../delivery/delivery.service";
import { SettingsServices } from "../settings/settings.service";
import { TransitStation } from "../transit_station/transit_station.model";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import {
  DeliveryType,
  IAddressSnapshot,
  ICheckoutItemInput,
  ICheckoutSummaryInput,
  ISubOrderItem,
  ISubOrderModification,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SettlementStatus,
  SubOrderStatus,
} from "./order.interface";
import { Order } from "./order.model";
import { SubOrder } from "./sub_order.model";

/**
 * Resolves address snapshot from direct snapshot, saved address ID, or user default address.
 */
const resolveAddress = async (
  customerId: string,
  input: {
    addressId?: string;
    addressSnapshot?: {
      fullName: string;
      phone: string;
      city: string;
      commune?: string;
      neighborhood?: string;
      landmark?: string;
      directions?: string;
      location: { lat: number; lng: number };
      placePhoto?: { url: string; publicId: string };
    };
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
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

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
      "Please provide or select a delivery address",
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

/**
 * Helper to derive parent Order status from an array of SubOrders.
 */
const deriveOrderStatus = (statuses: SubOrderStatus[]): OrderStatus => {
  if (statuses.length === 0) return OrderStatus.active;
  const allCancelled = statuses.every((s) => s === SubOrderStatus.cancelled);
  if (allCancelled) return OrderStatus.cancelled;

  const allDelivered = statuses.every((s) => s === SubOrderStatus.delivered);
  if (allDelivered) return OrderStatus.completed;

  const someCancelled = statuses.some((s) => s === SubOrderStatus.cancelled);
  const someDelivered = statuses.some((s) => s === SubOrderStatus.delivered);
  if (someCancelled && someDelivered) return OrderStatus.partially_cancelled;

  return OrderStatus.active;
};

/**
 * Calculates checkout pricing, delivery fees, platform fee, and splits by vendor.
 */
const calculateCheckout = async (
  customerId: string,
  payload: ICheckoutSummaryInput,
) => {
  const addressSnapshot = await resolveAddress(customerId, {
    addressId: payload.addressId,
    addressSnapshot: payload.addressSnapshot as any,
  });

  // Determine items to checkout
  let itemInputs: ICheckoutItemInput[] = [];
  if (payload.items && payload.items.length > 0) {
    itemInputs = payload.items;
  } else {
    const cart = await Cart.findOne({ userId: customerId });
    if (!cart || cart.items.length === 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Your cart is empty. Add items before checking out.",
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
        `Product with ID ${input.productId} not found`,
      );
    }
    if (product.approvalStatus !== ProductApprovalStatus.approved) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Product "${product.name}" is not approved for sale`,
      );
    }
    if (!product.isAvailable) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Product "${product.name}" is marked unavailable by vendor`,
      );
    }
    if (product.stockQty < input.qty) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Insufficient stock for "${product.name}". Available: ${product.stockQty}, requested: ${input.qty}`,
      );
    }
  }

  // Group items by vendor
  const vendorMap = new Map<string, { product: any; qty: number }[]>();
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
    commissionRate: number;
    commissionAmount: number;
    vendorEarning: number;
    total: number;
  }> = [];

  let overallSubtotal = 0;
  let overallDeliveryFee = 0;

  for (const [vendorId, itemsList] of vendorMap.entries()) {
    const vendorProfile = vendorProfileMap.get(vendorId);
    const storeName = vendorProfile?.storeName || "Vendor";

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
    } else if (payload.deliveryType === DeliveryType.intercity) {
      if (!payload.destinationStationId) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "destinationStationId is required for intercity delivery",
        );
      }

      // Find nearest station to vendor or default
      const defaultFromStation = await TransitStation.findOne({
        isActive: true,
      });
      if (!defaultFromStation) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "No active transit stations configured for intercity delivery",
        );
      }

      const rateResult = await DeliveryRateServices.calculateDeliveryFee({
        type: DeliveryRateType.intercity,
        fromStationId: String(defaultFromStation._id),
        toStationId: payload.destinationStationId,
      });
      vendorDeliveryFee = rateResult.fee;
    } else if (payload.deliveryType === DeliveryType.station_pickup) {
      // Station pickup has standard local or station fee
      vendorDeliveryFee = 10000;
    }

    const commissionAmount = Math.max(
      Math.round((commissionRate / 100) * vendorSubtotal),
      commissionMin,
    );
    const vendorEarning = vendorSubtotal - commissionAmount;
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
      commissionRate,
      commissionAmount,
      vendorEarning,
      total: vendorTotal,
    });
  }

  const taxAmount = Math.round(overallSubtotal * (taxRate / 100));
  const total = overallSubtotal + overallDeliveryFee + taxAmount + platformFee;

  return {
    addressSnapshot,
    deliveryType: payload.deliveryType,
    destinationStationId: payload.destinationStationId,
    paymentMethod: payload.paymentMethod,
    pricing: {
      subtotal: overallSubtotal,
      deliveryFee: overallDeliveryFee,
      taxAmount,
      platformFee,
      discount: 0,
      total,
    },
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
  const calculation = await calculateCheckout(customerId, payload);

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
          `Item "${item.name}" ran out of stock during checkout. Please try again.`,
        );
      }
    }
  }

  // Generate order number
  const orderNumber = await CounterServices.nextCode("order");

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
    total: calculation.pricing.total,
    status: OrderStatus.active,
    placedAt: new Date(),
  });

  // Create sub-orders
  const createdSubOrders = [];
  let index = 1;

  for (const split of calculation.vendorSplits) {
    const subOrderNumber = `${orderNumber}-${index}`;
    index += 1;

    // COD cash amount to collect
    let codAmountToCollect: number | undefined;
    if (calculation.paymentMethod === PaymentMethod.cod) {
      codAmountToCollect =
        split.total +
        (index === 2
          ? calculation.pricing.platformFee + calculation.pricing.taxAmount
          : 0);
    }

    const subOrder = await SubOrder.create({
      orderId: order._id,
      subOrderNumber,
      customerId: new Types.ObjectId(customerId),
      vendorId: new Types.ObjectId(split.vendorId),
      items: split.items,
      timeline: [
        {
          status: "order_placed",
          note: "Order placed by customer",
          byUserId: new Types.ObjectId(customerId),
          at: new Date(),
        },
      ],
      modifications: [],
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      discountShare: 0,
      total: split.total,
      commissionRate: split.commissionRate,
      commissionAmount: split.commissionAmount,
      vendorEarning: split.vendorEarning,
      status: SubOrderStatus.new,
      settlement: SettlementStatus.held,
      codAmountToCollect,
    });

    createdSubOrders.push(subOrder);
    await DeliveryServices.createDeliveryLegsForSubOrder(String(subOrder._id));
  }

  // Clear customer's cart
  await Cart.findOneAndUpdate(
    { userId: customerId },
    { $set: { items: [] } },
  );

  return {
    order,
    subOrders: createdSubOrders,
  };
};

/**
 * Customer fetches their orders with pagination.
 */
const getMyOrders = async (
  customerId: string,
  query: { page?: number; limit?: number; status?: OrderStatus },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { customerId };
  if (query.status) filter.status = query.status;

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);

  const orderIds = orders.map((o) => o._id);
  const subOrders = await SubOrder.find({ orderId: { $in: orderIds } })
    .populate("vendorId", "storeName logo address")
    .select("orderId subOrderNumber vendorId status total items");

  const subOrderMap = new Map<string, any[]>();
  for (const so of subOrders) {
    const key = String(so.orderId);
    if (!subOrderMap.has(key)) subOrderMap.set(key, []);
    subOrderMap.get(key)!.push(so);
  }

  const data = orders.map((o) => ({
    ...o.toObject(),
    subOrders: subOrderMap.get(String(o._id)) || [],
  }));

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data,
  };
};

/**
 * Get detailed view of an order with its sub-orders.
 */
const getOrderDetails = async (orderId: string, customerId?: string) => {
  const filter: Record<string, unknown> = { _id: orderId };
  if (customerId) filter.customerId = customerId;

  const order = await Order.findOne(filter);
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Order not found");
  }

  const subOrders = await SubOrder.find({ orderId: order._id })
    .populate("vendorId", "storeName logo businessPhone address isPlatformStore")
    .populate("currentRiderId", "vehicleType vehicleBrand plateNumber")
    .sort({ createdAt: 1 });

  return {
    order,
    subOrders,
  };
};

/**
 * Customer cancels an order before vendor starts preparing.
 */
const cancelOrder = async (
  orderId: string,
  customerId: string,
  reason: string,
) => {
  const order = await Order.findOne({ _id: orderId, customerId });
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Order not found");
  }

  if (order.status === OrderStatus.cancelled) {
    throw new AppError(httpStatus.BAD_REQUEST, "Order is already cancelled");
  }

  const subOrders = await SubOrder.find({ orderId: order._id });

  // Check if any sub-order is already preparing or ready
  const cannotCancel = subOrders.some((so) =>
    [
      SubOrderStatus.preparing,
      SubOrderStatus.ready_for_pickup,
      SubOrderStatus.in_delivery,
      SubOrderStatus.delivered,
    ].includes(so.status),
  );

  if (cannotCancel) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot cancel order. One or more items are already being prepared or in delivery.",
    );
  }

  // Cancel sub-orders and restore stock
  for (const so of subOrders) {
    if (so.status !== SubOrderStatus.cancelled) {
      so.status = SubOrderStatus.cancelled;
      so.cancellation = {
        by: "customer",
        reason,
        at: new Date(),
      };
      so.timeline.push({
        status: "cancelled",
        note: `Cancelled by customer: ${reason}`,
        byUserId: new Types.ObjectId(customerId),
        at: new Date(),
      });
      await so.save();

      // Restore stock
      for (const item of so.items) {
        if (!item.removed) {
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { stockQty: item.qty, soldCount: -item.qty },
          });
        }
      }
    }
  }

  order.status = OrderStatus.cancelled;
  await order.save();

  return {
    order,
    subOrders,
  };
};

/**
 * Vendor retrieves their assigned sub-orders.
 */
const getVendorSubOrders = async (
  vendorUserId: string,
  query: { page?: number; limit?: number; status?: SubOrderStatus },
) => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) {
    throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { vendorId: vendor._id };
  if (query.status) filter.status = query.status;

  const [subOrders, total] = await Promise.all([
    SubOrder.find(filter)
      .populate("customerId", "name phone avatar")
      .populate("currentRiderId", "vehicleType plateNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    SubOrder.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: subOrders,
  };
};

/**
 * Vendor gets full detail of a sub-order.
 */
const getVendorSubOrderDetail = async (
  vendorUserId: string,
  subOrderId: string,
) => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) {
    throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
  })
    .populate("customerId", "name phone avatar")
    .populate("currentRiderId", "vehicleType plateNumber vestNumber");

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");
  }

  const parentOrder = await Order.findById(subOrder.orderId).select(
    "orderNumber addressSnapshot deliveryType specialInstructions paymentMethod paymentStatus",
  );

  return {
    subOrder,
    parentOrder,
  };
};

/**
 * Vendor advances sub-order status (accepted -> preparing -> ready_for_pickup).
 */
const updateSubOrderStatus = async (
  vendorUserId: string,
  subOrderId: string,
  newStatus: SubOrderStatus,
  note?: string,
  estimatedDeliveryMinutes?: number,
) => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) {
    throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
  });

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");
  }

  // Allowed transitions
  const validTransitions: Record<SubOrderStatus, SubOrderStatus[]> = {
    [SubOrderStatus.new]: [SubOrderStatus.accepted, SubOrderStatus.cancelled],
    [SubOrderStatus.accepted]: [
      SubOrderStatus.preparing,
      SubOrderStatus.cancelled,
    ],
    [SubOrderStatus.preparing]: [
      SubOrderStatus.ready_for_pickup,
      SubOrderStatus.cancelled,
    ],
    [SubOrderStatus.ready_for_pickup]: [SubOrderStatus.in_delivery],
    [SubOrderStatus.in_delivery]: [SubOrderStatus.delivered],
    [SubOrderStatus.delivered]: [],
    [SubOrderStatus.cancelled]: [],
  };

  if (!validTransitions[subOrder.status]?.includes(newStatus)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot transition sub-order from "${subOrder.status}" to "${newStatus}"`,
    );
  }

  subOrder.status = newStatus;
  subOrder.timeline.push({
    status: newStatus,
    note: note || `Status updated to ${newStatus}`,
    byUserId: new Types.ObjectId(vendorUserId),
    at: new Date(),
  });

  if (estimatedDeliveryMinutes) {
    subOrder.estimatedDeliveryAt = new Date(
      Date.now() + estimatedDeliveryMinutes * 60 * 1000,
    );
  }

  await subOrder.save();

  // Re-sync parent order status
  const allSubOrders = await SubOrder.find({ orderId: subOrder.orderId });
  const newOrderStatus = deriveOrderStatus(allSubOrders.map((s) => s.status));
  await Order.findByIdAndUpdate(subOrder.orderId, { status: newOrderStatus });

  return subOrder;
};

/**
 * Vendor edits an order after customer chat (remove item or update qty).
 */
const modifySubOrderItems = async (
  vendorUserId: string,
  subOrderId: string,
  modifications: {
    productId: string;
    action: "remove" | "update_qty";
    newQty?: number;
  }[],
  reason?: string,
) => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) {
    throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
  });

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");
  }

  // Only allowed before pickup
  if (
    ![
      SubOrderStatus.new,
      SubOrderStatus.accepted,
      SubOrderStatus.preparing,
    ].includes(subOrder.status)
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot modify order items after it has been marked ready for pickup or handed to delivery.",
    );
  }

  const oldTotal = subOrder.total;
  const removedRecord: ISubOrderModification["removedItems"] = [];

  for (const mod of modifications) {
    const item = subOrder.items.find(
      (i) => String(i.productId) === mod.productId && !i.removed,
    );
    if (!item) continue;

    if (mod.action === "remove") {
      item.removed = true;
      removedRecord.push({
        productId: item.productId,
        name: item.name,
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      });

      // Restore stock
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stockQty: item.qty, soldCount: -item.qty },
      });
    } else if (mod.action === "update_qty" && mod.newQty !== undefined) {
      const newQty = Math.max(0, mod.newQty);
      if (newQty === 0) {
        item.removed = true;
        removedRecord.push({
          productId: item.productId,
          name: item.name,
          qty: item.qty,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        });
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { stockQty: item.qty, soldCount: -item.qty },
        });
      } else {
        const qtyDiff = item.qty - newQty;
        if (qtyDiff > 0) {
          // restored items
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { stockQty: qtyDiff, soldCount: -qtyDiff },
          });
        } else if (qtyDiff < 0) {
          // deducting more items
          const product = await Product.findById(item.productId);
          if (!product || product.stockQty < Math.abs(qtyDiff)) {
            throw new AppError(
              httpStatus.BAD_REQUEST,
              `Insufficient stock for "${item.name}"`,
            );
          }
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { stockQty: qtyDiff, soldCount: -qtyDiff },
          });
        }

        item.qty = newQty;
        item.lineTotal = item.unitPrice * newQty;
        removedRecord.push({
          productId: item.productId,
          name: item.name,
          qty: Math.abs(qtyDiff),
          unitPrice: item.unitPrice,
          lineTotal: item.unitPrice * Math.abs(qtyDiff),
        });
      }
    }
  }

  // Recalculate subtotal of active items
  const activeItems = subOrder.items.filter((i) => !i.removed);
  const newSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);

  // Recalculate commission
  const commissionRate = subOrder.commissionRate || 10;
  const newCommissionAmount = Math.max(
    Math.round((commissionRate / 100) * newSubtotal),
    1000,
  );
  const newVendorEarning = newSubtotal - newCommissionAmount;
  const newTotal = newSubtotal + subOrder.deliveryFee - subOrder.discountShare;
  const refundAmount = Math.max(0, oldTotal - newTotal);

  subOrder.subtotal = newSubtotal;
  subOrder.commissionAmount = newCommissionAmount;
  subOrder.vendorEarning = newVendorEarning;
  subOrder.total = newTotal;
  if (subOrder.codAmountToCollect) {
    subOrder.codAmountToCollect = newTotal;
  }

  // Record modification
  subOrder.modifications.push({
    removedItems: removedRecord,
    oldTotal,
    newTotal,
    refundAmount,
    byUserId: new Types.ObjectId(vendorUserId),
    at: new Date(),
  });

  subOrder.timeline.push({
    status: "order_modified",
    note: `Order modified by vendor: ${reason || "Customer chat agreement"}`,
    byUserId: new Types.ObjectId(vendorUserId),
    at: new Date(),
  });

  await subOrder.save();

  // Re-sync parent Order totals
  const allSubOrders = await SubOrder.find({ orderId: subOrder.orderId });
  const parentSubtotal = allSubOrders.reduce((sum, so) => sum + so.subtotal, 0);
  const parentDeliveryFee = allSubOrders.reduce(
    (sum, so) => sum + so.deliveryFee,
    0,
  );

  const parentOrder = await Order.findById(subOrder.orderId);
  if (parentOrder) {
    parentOrder.subtotal = parentSubtotal;
    parentOrder.deliveryFee = parentDeliveryFee;
    parentOrder.total =
      parentSubtotal +
      parentDeliveryFee +
      parentOrder.taxAmount +
      parentOrder.platformFee -
      parentOrder.discount;
    await parentOrder.save();
  }

  return subOrder;
};

/**
 * Vendor cancels their sub-order (e.g. unable to fulfill).
 */
const cancelVendorSubOrder = async (
  vendorUserId: string,
  subOrderId: string,
  reason: string,
) => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) {
    throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
  });

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");
  }

  if (
    ![
      SubOrderStatus.new,
      SubOrderStatus.accepted,
      SubOrderStatus.preparing,
    ].includes(subOrder.status)
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot cancel sub-order once ready for pickup or in delivery.",
    );
  }

  subOrder.status = SubOrderStatus.cancelled;
  subOrder.cancellation = {
    by: "vendor",
    reason,
    at: new Date(),
  };
  subOrder.timeline.push({
    status: "cancelled",
    note: `Cancelled by vendor: ${reason}`,
    byUserId: new Types.ObjectId(vendorUserId),
    at: new Date(),
  });
  await subOrder.save();

  // Restore stock
  for (const item of subOrder.items) {
    if (!item.removed) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stockQty: item.qty, soldCount: -item.qty },
      });
    }
  }

  // Update parent order status
  const allSubOrders = await SubOrder.find({ orderId: subOrder.orderId });
  const newOrderStatus = deriveOrderStatus(allSubOrders.map((s) => s.status));
  await Order.findByIdAndUpdate(subOrder.orderId, { status: newOrderStatus });

  return subOrder;
};

/**
 * Admin: List all orders with filters.
 */
const getAllOrdersAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  search?: string;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.search) {
    filter.$or = [
      { orderNumber: new RegExp(query.search, "i") },
      { "addressSnapshot.fullName": new RegExp(query.search, "i") },
      { "addressSnapshot.phone": new RegExp(query.search, "i") },
    ];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate("customerId", "name phone email avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: orders,
  };
};

/**
 * Admin cancels sub-order.
 */
const adminCancelSubOrder = async (
  subOrderId: string,
  reason: string,
  adminUserId: string,
) => {
  const subOrder = await SubOrder.findById(subOrderId);
  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");
  }

  if (subOrder.status === SubOrderStatus.cancelled) {
    throw new AppError(httpStatus.BAD_REQUEST, "Sub-order is already cancelled");
  }

  subOrder.status = SubOrderStatus.cancelled;
  subOrder.cancellation = {
    by: "admin",
    reason,
    at: new Date(),
  };
  subOrder.timeline.push({
    status: "cancelled",
    note: `Cancelled by admin: ${reason}`,
    byUserId: new Types.ObjectId(adminUserId),
    at: new Date(),
  });
  await subOrder.save();

  // Restore stock
  for (const item of subOrder.items) {
    if (!item.removed) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stockQty: item.qty, soldCount: -item.qty },
      });
    }
  }

  // Update parent order
  const allSubOrders = await SubOrder.find({ orderId: subOrder.orderId });
  const newOrderStatus = deriveOrderStatus(allSubOrders.map((s) => s.status));
  await Order.findByIdAndUpdate(subOrder.orderId, { status: newOrderStatus });

  return subOrder;
};

export const OrderServices = {
  calculateCheckout,
  placeOrder,
  getMyOrders,
  getOrderDetails,
  cancelOrder,
  getVendorSubOrders,
  getVendorSubOrderDetail,
  updateSubOrderStatus,
  modifySubOrderItems,
  cancelVendorSubOrder,
  getAllOrdersAdmin,
  adminCancelSubOrder,
};

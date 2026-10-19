/**
 * Customer side: my orders, order details, cancellation.
 */
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { DeliveryStatus } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { OrderStatus, SubOrderStatus } from "./order.interface";
import { Order } from "./order.model";
import { SubOrder } from "./sub_order.model";
import { cancelSubOrder, syncOrderStatus } from "./order.utils";

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

  const subOrderMap = new Map<string, typeof subOrders>();
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
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

/**
 * Get detailed view of an order with its sub-orders.
 */
const getOrderDetails = async (
  orderId: string,
  customerId?: string,
  options: { admin?: boolean } = {},
) => {
  const filter: Record<string, unknown> = { _id: orderId };
  if (customerId) filter.customerId = customerId;

  const orderQuery = Order.findOne(filter);
  // Admins also see who the customer is
  if (options.admin) orderQuery.populate("customerId", "name phone email avatar");
  const order = await orderQuery;
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Order not found");
  }

  const subOrders = await SubOrder.find({ orderId: order._id })
    // No businessPhone: buyers and sellers talk through in-app chat (anti off-platform rule)
    .populate("vendorId", "storeName logo address isPlatformStore")
    .populate("currentRiderId", "partnerType vehicle stats")
    .sort({ createdAt: 1 });

  // Delivery legs (1 local, 2–3 intercity) so the app can track each leg; PINs are never included
  const legsQuery = Delivery.find({ subOrderId: { $in: subOrders.map((s) => s._id) } })
    .select(
      options.admin
        ? "subOrderId legNumber legType status fromKind fromName toKind toName riderId fee collectsCash assignedAt pickedUpAt deliveredAt"
        : "subOrderId legNumber legType status fromKind fromName toKind toName riderId",
    )
    .sort({ legNumber: 1 });
  // Admins see which partner holds each leg
  if (options.admin) {
    legsQuery.populate({
      path: "riderId",
      select: "userId partnerType vehicle",
      populate: { path: "userId", select: "name phone" },
    });
  }
  const legs = await legsQuery.lean();

  // The buyer's own delivery PIN (handover PIN of each final leg) so the app can
  // show "give this code to the rider" without one tracking call per store.
  // Only while that leg is still open; never for admins.
  const deliveryPins = new Map<string, string>();
  if (customerId && !options.admin) {
    const finalLegIds = subOrders
      .map((so) =>
        legs
          .filter((l) => String(l.subOrderId) === String(so._id))
          .reduce<(typeof legs)[number] | undefined>(
            (last, l) => (!last || l.legNumber > last.legNumber ? l : last),
            undefined,
          ),
      )
      .filter(
        (l): l is (typeof legs)[number] =>
          Boolean(l) &&
          ![DeliveryStatus.delivered, DeliveryStatus.cancelled].includes(l!.status),
      )
      .map((l) => l._id);
    const finalLegs = await Delivery.find({ _id: { $in: finalLegIds } })
      .select("subOrderId +handoverPin")
      .lean();
    for (const l of finalLegs) deliveryPins.set(String(l.subOrderId), l.handoverPin);
  }

  return {
    order,
    subOrders: subOrders.map((so) => ({
      ...so.toObject(),
      deliveries: legs.filter((l) => String(l.subOrderId) === String(so._id)),
      ...(deliveryPins.has(String(so._id)) && { deliveryPin: deliveryPins.get(String(so._id)) }),
    })),
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

  // Each cancel is an atomic claim: if a vendor moved a sub-order to "preparing"
  // in the meantime, that one fails and the customer is asked to refresh
  try {
    for (const so of subOrders) {
      if (so.status !== SubOrderStatus.cancelled) {
        await cancelSubOrder({
          filter: { _id: so._id, customerId: order.customerId },
          allowedFrom: [SubOrderStatus.new, SubOrderStatus.accepted],
          by: "customer",
          reason,
          actorUserId: customerId,
          syncParent: false,
        });
      }
    }
  } finally {
    await syncOrderStatus(order._id);
  }

  return {
    order: await Order.findById(order._id),
    subOrders: await SubOrder.find({ orderId: order._id }),
  };
};

export {
  getMyOrders,
  getOrderDetails,
  cancelOrder,
};

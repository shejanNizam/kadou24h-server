/**
 * Admin side: all orders and admin cancellation.
 */
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { Types } from "mongoose";
import { OrderStatus, PaymentMethod, PaymentStatus, SubOrderStatus } from "./order.interface";
import { Order } from "./order.model";
import { SubOrder } from "./sub_order.model";
import { cancelSubOrder } from "./order.utils";
import { containsRegex } from "../../utils/queryParams";

/**
 * Admin: List all orders with filters.
 */
const getAllOrdersAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  customerId?: string;
  search?: string;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
  if (query.customerId) {
    if (!Types.ObjectId.isValid(query.customerId)) {
      throw new AppError(httpStatus.BAD_REQUEST, "INVALID_ID");
    }
    filter.customerId = new Types.ObjectId(query.customerId);
  }
  if (query.search) {
    filter.$or = [
      { orderNumber: containsRegex(query.search) },
      { "addressSnapshot.fullName": containsRegex(query.search) },
      { "addressSnapshot.phone": containsRegex(query.search) },
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
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
    throw new AppError(httpStatus.NOT_FOUND, "SUB_ORDER_NOT_FOUND");
  }

  if (subOrder.status === SubOrderStatus.cancelled) {
    throw new AppError(httpStatus.BAD_REQUEST, "SUB_ORDER_ALREADY_CANCELLED");
  }

  // Delivered goods are sold: money goes back through a refund, not a cancel
  if (subOrder.status === SubOrderStatus.delivered) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "SUB_ORDER_DELIVERED_REFUND",
    );
  }

  return cancelSubOrder({
    filter: { _id: subOrder._id },
    allowedFrom: [
      SubOrderStatus.pending_payment,
      SubOrderStatus.new,
      SubOrderStatus.accepted,
      SubOrderStatus.preparing,
      SubOrderStatus.ready_for_pickup,
      SubOrderStatus.in_delivery,
    ],
    by: "admin",
    reason,
    actorUserId: adminUserId,
  });
};

export {
  getAllOrdersAdmin,
  adminCancelSubOrder,
};

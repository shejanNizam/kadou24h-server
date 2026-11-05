/**
 * Refunds to customers who paid online (Orange Money / MoMo / card).
 *
 * - A store, the customer or an admin cancels a paid order, or a store removes
 *   items: `requestRefund` opens ONE pending request per order (or adds a line
 *   to it). Nothing is paid out yet; the customer sees "refund being reviewed".
 * - An admin sends the money, then approves the request with the transfer
 *   reference (`processRefund`), or rejects it with a reason.
 * - Disputes and manual refunds are created already approved (`issueRefund`).
 *
 * Never more than the customer actually paid: paid − refunded − already requested.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { logger } from "../../utils/logger";
import { emitToUser } from "../../../socket/socket";
import { Notify } from "../notification/notification.events";
import { IOrder, OrderStatus, PaymentMethod as OrderPaymentMethod, PaymentStatus as OrderPaymentStatus } from "../order/order.interface";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { TransactionType, WalletEvent, WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import {
  IRefund,
  PaymentPurpose,
  PaymentStatus,
  RefundSource,
  RefundStatus,
} from "./payment.interface";
import { Payment } from "./payment.model";
import { Refund } from "./refund.model";

type OrderDoc = IOrder;

const PAID = [OrderPaymentStatus.paid, OrderPaymentStatus.partially_refunded];

// refId is Mixed: payments started from the app store the order id as a string
const findOrderPayment = (orderId: Types.ObjectId) =>
  Payment.findOne({ purpose: PaymentPurpose.order, refId: { $in: [orderId, String(orderId)] }, status: PaymentStatus.success });

/**
 * What the customer actually paid online. Not `order.total`: that shrinks when
 * a store removes items, while the money paid stays the same.
 */
const paidAmount = async (order: OrderDoc) => (await findOrderPayment(order._id))?.amount ?? order.total;

const sumRefunds = async (orderId: Types.ObjectId, statuses: RefundStatus[], excludeId?: Types.ObjectId) => {
  const [row] = await Refund.aggregate<{ total: number }>([
    { $match: { orderId, status: { $in: statuses }, ...(excludeId && { _id: { $ne: excludeId } }) } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return row?.total ?? 0;
};

/** Paid − already refunded − already requested (optionally ignoring one request) */
const refundableLeft = async (order: OrderDoc, excludeId?: Types.ObjectId) =>
  Math.max(0, (await paidAmount(order)) - (await sumRefunds(order._id, [RefundStatus.completed, RefundStatus.pending], excludeId)));

/**
 * Opens (or adds to) the order's pending refund request. Does nothing for COD
 * or unpaid orders — no money was taken. `amount` omitted = everything left.
 * Never throws: a cancellation must not fail because of the refund bookkeeping.
 */
const requestRefund = async (params: {
  orderId: Types.ObjectId | string;
  subOrderId?: Types.ObjectId | string;
  amount?: number;
  source: RefundSource;
  reason: string;
  by?: string;
  note?: string;
  paidAfterCancel?: boolean;
}) => {
  try {
    const order = await Order.findById(params.orderId);
    if (!order) return null;
    // Cash on delivery: only the fees were paid online (never the products: a store
    // removing items changes the cash, not what was paid online)
    const paidOnline =
      order.paymentMethod === OrderPaymentMethod.cod
        ? Boolean(order.feesPaidAt) && params.source !== RefundSource.modification
        : PAID.includes(order.paymentStatus);
    if (!paidOnline) return null;

    const left = await refundableLeft(order);
    const amount = Math.min(params.amount ?? left, left);
    if (amount <= 0) return null;

    const payment = await findOrderPayment(order._id);
    const line = {
      ...(params.subOrderId && { subOrderId: new Types.ObjectId(String(params.subOrderId)) }),
      source: params.source,
      reason: params.reason,
      ...(params.by && { by: params.by }),
      ...(params.note && { note: params.note }),
      ...(params.paidAfterCancel && { paidAfterCancel: true }),
      amount,
      at: new Date(),
    };
    const upsert = () =>
      Refund.findOneAndUpdate(
        { orderId: order._id, status: RefundStatus.pending },
        {
          $inc: { amount, requestedAmount: amount },
          $push: { lines: line },
          $setOnInsert: {
            customerId: order.customerId,
            paymentId: payment?._id,
            paymentMethod: order.paymentMethod,
            source: params.source,
            reason: params.reason,
            ...(params.subOrderId && { subOrderId: line.subOrderId }),
          },
        },
        { upsert: true, returnDocument: "after" },
      );

    let refund;
    try {
      refund = await upsert();
    } catch (error) {
      // Two cancellations opened the request at the same time: add to the winner
      if ((error as { code?: number }).code !== 11000) throw error;
      refund = await upsert();
    }

    if (refund && refund.lines.length === 1) Notify.refundRequested(refund, order.orderNumber);
    if (refund) emitToUser(String(order.customerId), "refund:requested", { orderId: order._id, amount: refund.amount });
    return refund;
  } catch (error) {
    logger.error("Failed to open a refund request", {
      orderId: String(params.orderId),
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
};

/** After a whole order is cancelled: what is left (platform fee, tax) joins the request. */
const requestRemainingIfCancelled = async (orderId: Types.ObjectId | string) => {
  const order = await Order.findById(orderId).select("status");
  if (order?.status !== OrderStatus.cancelled) return null;
  return requestRefund({
    orderId,
    source: RefundSource.order_fees,
    reason: "Order cancelled: service fee and tax",
  });
};

/** Money really went back: order payment status, vendor clawback, live event. */
const applyCompletedRefund = async (refund: IRefund, order: OrderDoc, actorUserId: string) => {
  const refunded = await sumRefunds(order._id, [RefundStatus.completed]);
  order.paymentStatus = refunded >= (await paidAmount(order)) ? OrderPaymentStatus.refunded : OrderPaymentStatus.partially_refunded;
  await order.save();

  // Disputes / manual refunds on goods the store was already paid for: take it back.
  // (Cancellations and item changes already reversed the store's pending money.)
  if (refund.subOrderId && [RefundSource.dispute, RefundSource.admin].includes(refund.source)) {
    const subOrder = await SubOrder.findById(refund.subOrderId);
    if (subOrder?.settlement === "released") {
      const vendor = await VendorProfile.findById(subOrder.vendorId);
      if (vendor) {
        const vendorWallet = await WalletServices.getMyWallet(String(vendor.userId), WalletMode.vendor);
        await WalletServices.recordTransaction({
          walletId: vendorWallet._id,
          type: TransactionType.refund_deduction,
          amount: refund.amount,
          subOrderId: subOrder._id,
          note: `Refund deduction for ${subOrder.subOrderNumber}: ${refund.reason}`,
          event: WalletEvent.refund,
          eventParams: { order: subOrder.subOrderNumber, reason: refund.lines?.[0]?.note ?? refund.reason },
          createdBy: actorUserId,
        });
      }
    }
  }

  emitToUser(String(order.customerId), "refund:issued", {
    refundId: refund._id,
    orderId: order._id,
    amount: refund.amount,
    reason: refund.reason,
  });
};

/** Admin decides a pending request: approve (after sending the money) or reject. */
const processRefund = async (
  adminUserId: string,
  refundId: string,
  payload: {
    status: "completed" | "rejected";
    amount?: number;
    transactionId?: string;
    rejectionReason?: string;
    notes?: string;
  },
) => {
  const existing = await Refund.findById(refundId);
  if (!existing) throw new AppError(httpStatus.NOT_FOUND, "REFUND_NOT_FOUND");
  if (existing.status !== RefundStatus.pending) {
    throw new AppError(httpStatus.BAD_REQUEST, "REFUND_ALREADY_HANDLED", { status: existing.status });
  }
  const order = await Order.findById(existing.orderId);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, "ORDER_NOT_FOUND");

  const amount = payload.amount ?? existing.amount;
  if (payload.status === "completed") {
    if (amount > existing.amount) {
      throw new AppError(httpStatus.BAD_REQUEST, "REFUND_ABOVE_REQUESTED", { amount: existing.amount });
    }
    const left = await refundableLeft(order, existing._id);
    if (amount > left) {
      throw new AppError(httpStatus.BAD_REQUEST, "REFUND_ABOVE_LEFT", { left });
    }
  }

  // Claim it atomically — two admins cannot both approve (and pay) the same request
  const refund = await Refund.findOneAndUpdate(
    { _id: existing._id, status: RefundStatus.pending },
    {
      $set: {
        status: payload.status,
        issuedBy: new Types.ObjectId(adminUserId),
        processedAt: new Date(),
        ...(payload.notes && { notes: payload.notes }),
        ...(payload.status === "completed"
          ? { amount, ...(payload.transactionId && { transactionId: payload.transactionId }) }
          : { rejectionReason: payload.rejectionReason }),
      },
    },
    { returnDocument: "after" },
  );
  if (!refund) throw new AppError(httpStatus.CONFLICT, "REFUND_CONFLICT");

  if (payload.status === "completed") await applyCompletedRefund(refund, order, adminUserId);
  Notify.refundProcessed(refund, order.orderNumber, payload.status);
  return refund;
};

/** Admin refunds by hand or when resolving a dispute: created already approved. */
const issueRefund = async (
  adminUserId: string,
  payload: {
    orderId: string;
    subOrderId?: string;
    amount: number;
    reason: string;
    /** The admin's own words when `reason` is a summary (dispute) */
    note?: string;
    notes?: string;
    transactionId?: string;
    source?: RefundSource.admin | RefundSource.dispute;
  },
) => {
  const order = await Order.findById(payload.orderId);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, "ORDER_NOT_FOUND");

  // Only money the customer actually paid can go back
  if (order.paymentStatus === OrderPaymentStatus.unpaid) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "REFUND_NOTHING_PAID",
    );
  }

  const left = await refundableLeft(order);
  if (payload.amount > left) {
    const waiting = await sumRefunds(order._id, [RefundStatus.pending]);
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "REFUND_EXCEEDS_LEFT",
      { amount: payload.amount, left, waiting: waiting || 0 },
    );
  }

  const payment = await findOrderPayment(order._id);
  const source = payload.source ?? RefundSource.admin;
  const refund = await Refund.create({
    orderId: order._id,
    subOrderId: payload.subOrderId ? new Types.ObjectId(payload.subOrderId) : undefined,
    paymentId: payment?._id,
    paymentMethod: order.paymentMethod,
    customerId: order.customerId,
    amount: payload.amount,
    requestedAmount: payload.amount,
    source,
    reason: payload.reason,
    lines: [
      {
        ...(payload.subOrderId && { subOrderId: new Types.ObjectId(payload.subOrderId) }),
        source,
        reason: payload.reason,
        // Typed by the admin (refund or dispute resolution)
        note: payload.note ?? payload.reason,
        amount: payload.amount,
        at: new Date(),
      },
    ],
    notes: payload.notes,
    transactionId: payload.transactionId,
    status: RefundStatus.completed,
    issuedBy: new Types.ObjectId(adminUserId),
    processedAt: new Date(),
  });

  await applyCompletedRefund(refund, order, adminUserId);
  Notify.refundProcessed(refund, order.orderNumber, "completed");
  return refund;
};

/** The customer's view on the order screen (no admin notes). */
const getOrderRefunds = (orderId: Types.ObjectId | string) =>
  Refund.find({ orderId })
    .select("amount requestedAmount status source transactionId rejectionReason processedAt createdAt")
    .sort({ createdAt: -1 })
    .lean();

export const RefundServices = {
  requestRefund,
  requestRemainingIfCancelled,
  processRefund,
  issueRefund,
  getOrderRefunds,
};

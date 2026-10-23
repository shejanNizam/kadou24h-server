/**
 * Online-paid orders (Orange Money, Mobile Money, card) reach the store only once paid.
 * Cash-on-delivery orders too, once their fees (service, tax, delivery) are paid online
 * (client, 2026-10-23); their products are then paid in cash to the riders.
 *
 * At checkout the order's sub-orders are created as `pending_payment`: the stock is
 * reserved, but the store sees nothing, no escrow is held and no delivery is planned.
 * - Payment confirmed → each sub-order becomes `new`: escrow held, delivery legs created,
 *   the store notified (confirmOrderPaid).
 * - Not paid within PAYMENT_WINDOW_MINUTES → the order is cancelled, the stock released
 *   and the items put back in the customer's cart (expireUnpaidOrders, run every minute).
 * - Paid after that → the money goes into a refund request for the admin.
 */
import { Types } from "mongoose";
import { logger } from "../../utils/logger";
import { Cart } from "../cart/cart.model";
import { DeliveryServices } from "../delivery/delivery.service";
import { Notify } from "../notification/notification.events";
import { PaymentPurpose, PaymentStatus as PaymentRecordStatus, RefundSource } from "../payment/payment.interface";
import { Payment } from "../payment/payment.model";
import { RefundServices } from "../payment/refund.service";
import { holdEscrow, PAYMENT_WINDOW_MINUTES } from "./order.checkout.service";
import { ISubOrderItem, OrderStatus, PaymentMethod, PaymentStatus, SubOrderStatus } from "./order.interface";
import { Order } from "./order.model";
import { cancelSubOrder, syncOrderStatus } from "./order.utils";
import { SubOrder } from "./sub_order.model";

/** The order's payment succeeded (gateway webhook or the dev simulator). Safe to call twice. */
const confirmOrderPaid = async (orderId: Types.ObjectId | string) => {
  const current = await Order.findById(orderId).select("paymentMethod");
  if (!current) return;
  // Cash on delivery: only the fees were paid online; the products are paid at the door
  const order = await Order.findByIdAndUpdate(
    orderId,
    current.paymentMethod === PaymentMethod.cod ? { feesPaidAt: new Date() } : { paymentStatus: PaymentStatus.paid },
    { returnDocument: "after" },
  );
  if (!order) return;

  const pending = await SubOrder.find({ orderId: order._id, status: SubOrderStatus.pending_payment }).select("_id");
  const now = new Date();
  for (const { _id } of pending) {
    // Atomic claim: the expiry sweep may be cancelling it at the same moment
    const subOrder = await SubOrder.findOneAndUpdate(
      { _id, status: SubOrderStatus.pending_payment },
      {
        $set: { status: SubOrderStatus.new },
        $push: {
          timeline: {
            status: "payment_received",
            note:
              order.paymentMethod === PaymentMethod.cod
                ? "Fees paid online — order sent to the store (products paid in cash at delivery)"
                : "Online payment received — order sent to the store",
            byUserId: order.customerId,
            at: now,
          },
        },
      },
      { returnDocument: "after" },
    );
    if (!subOrder) continue;
    try {
      await holdEscrow(subOrder, String(order.customerId));
      await DeliveryServices.createDeliveryLegsForSubOrder(String(subOrder._id));
    } catch (error) {
      // The money is in: keep the order and leave a loud trace for the team
      logger.error("Paid order could not be fully set up", {
        subOrderId: String(subOrder._id),
        error: error instanceof Error ? error.message : error,
      });
    }
    Notify.orderPlaced(subOrder);
  }

  // Paid after the order was cancelled (window over, or the customer cancelled): money back
  if (pending.length === 0 && order.status === OrderStatus.cancelled) {
    await RefundServices.requestRefund({
      orderId: order._id,
      source: RefundSource.cancellation,
      reason: `${order.orderNumber}: paid after the order was cancelled`,
    });
  }
};

/** Puts the items of an expired order back in the customer's cart (quantities merged). */
const restoreToCart = async (customerId: Types.ObjectId, items: { item: ISubOrderItem; vendorId: Types.ObjectId }[]) => {
  const cart = (await Cart.findOne({ userId: customerId })) ?? new Cart({ userId: customerId, items: [] });
  for (const { item, vendorId } of items) {
    const line = cart.items.find((i) => String(i.productId) === String(item.productId));
    if (line) line.qty = Math.max(line.qty, item.qty);
    else cart.items.push({ productId: item.productId, vendorId, qty: item.qty });
  }
  await cart.save();
};

/** Cancels online orders whose payment window is over. Run every minute; safe on several servers. */
const expireUnpaidOrders = async (now = new Date()) => {
  const due = await Order.find({
    paymentDueAt: { $lte: now },
    paymentStatus: PaymentStatus.unpaid,
    // COD orders stay "unpaid" until delivered: only those whose fees never came expire
    feesPaidAt: { $exists: false },
    status: OrderStatus.active,
  })
    .select("_id orderNumber customerId")
    .limit(100);

  let expired = 0;
  for (const order of due) {
    // A payment confirmed meanwhile wins (its webhook finishes the order)
    const paid = await Payment.exists({
      purpose: PaymentPurpose.order,
      refId: { $in: [order._id, String(order._id)] },
      status: PaymentRecordStatus.success,
    });
    if (paid) continue;

    const subOrders = await SubOrder.find({ orderId: order._id, status: SubOrderStatus.pending_payment });
    const back: { item: ISubOrderItem; vendorId: Types.ObjectId }[] = [];
    for (const so of subOrders) {
      try {
        await cancelSubOrder({
          filter: { _id: so._id },
          allowedFrom: [SubOrderStatus.pending_payment],
          by: "system",
          reason: `Payment not received within ${PAYMENT_WINDOW_MINUTES} minutes`,
          actorUserId: String(order.customerId),
          syncParent: false,
          notify: false,
        });
        for (const item of so.items) if (!item.removed) back.push({ item, vendorId: so.vendorId });
      } catch {
        // Claimed by the payment at the same moment — leave it
      }
    }
    await syncOrderStatus(order._id);
    if (back.length) {
      await restoreToCart(order.customerId, back);
      Notify.orderPaymentExpired(order, PAYMENT_WINDOW_MINUTES);
      expired++;
    }
  }
  return expired;
};

const SWEEP_EVERY_MS = 60_000;

/** Starts the minute-by-minute expiry sweep (server start). */
const startPaymentExpirySweep = () => {
  const run = () =>
    expireUnpaidOrders().catch((error) =>
      logger.error("Unpaid order sweep failed", { error: error instanceof Error ? error.message : error }),
    );
  void run();
  const timer = setInterval(run, SWEEP_EVERY_MS);
  timer.unref();
  return timer;
};

export const OrderPaymentServices = {
  confirmOrderPaid,
  expireUnpaidOrders,
  startPaymentExpirySweep,
};

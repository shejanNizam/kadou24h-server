/**
 * Helpers shared by the order services.
 */
import httpStatus from "http-status";
import { QueryFilter, Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { DeliveryStatus } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { CancelledBy, Notify } from "../notification/notification.events";
import { Product } from "../product/product.model";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { WalletServices } from "../wallet/wallet.service";
import { CouponServices } from "../coupon/coupon.service";
import { RefundSource } from "../payment/payment.interface";
import { RefundServices } from "../payment/refund.service";
import { ISubOrder, OrderStatus, PaymentMethod, SettlementStatus, SubOrderStatus } from "./order.interface";
import { Order } from "./order.model";
import { SubOrder } from "./sub_order.model";

/**
 * Helper to derive parent Order status from an array of SubOrders.
 */
const deriveOrderStatus = (statuses: SubOrderStatus[]): OrderStatus => {
  if (statuses.length === 0) return OrderStatus.active;
  const finished = statuses.every(
    (s) => s === SubOrderStatus.delivered || s === SubOrderStatus.cancelled,
  );
  if (!finished) return OrderStatus.active;

  if (statuses.every((s) => s === SubOrderStatus.cancelled)) return OrderStatus.cancelled;
  if (statuses.every((s) => s === SubOrderStatus.delivered)) return OrderStatus.completed;
  return OrderStatus.partially_cancelled;
};

/** Re-computes and stores the parent order status from its sub-orders. */
const syncOrderStatus = async (orderId: Types.ObjectId | string) => {
  const subOrders = await SubOrder.find({ orderId }).select("status").lean();
  const status = deriveOrderStatus(subOrders.map((s) => s.status));
  await Order.updateOne({ _id: orderId }, { status });
  // Nothing was bought: the customer can use the promo code again
  if (status === OrderStatus.cancelled) await CouponServices.releaseForOrder(orderId);
  return status;
};

// Legs that have not reached the parcel yet
const NOT_PICKED_UP_LEGS = [
  DeliveryStatus.pending_assignment,
  DeliveryStatus.assigned,
  DeliveryStatus.accepted,
  DeliveryStatus.going_to_pickup,
];
// Legs a rider has accepted — counted in the rider's activeDeliveryCount
const ACTIVE_RIDER_LEGS = [
  DeliveryStatus.accepted,
  DeliveryStatus.going_to_pickup,
  DeliveryStatus.picked_up,
  DeliveryStatus.in_transit,
];

/**
 * The products cash of one COD part, before any extra it carries. Orders whose fees
 * were paid online first: products − promo share. Older COD orders: the whole part.
 */
const codCashBase = (
  part: Pick<ISubOrder, "subtotal" | "total"> & { discountShare?: number },
  feesPaidOnline: boolean,
) => (feesPaidOnline ? Math.max(0, part.subtotal - (part.discountShare ?? 0)) : part.total);

/**
 * Cancels one sub-order — the single path used by customer, vendor and admin.
 * The status change is an atomic claim, so two simultaneous cancels cannot
 * restore stock or reverse escrow twice. Then: stock back (unless the parcel
 * is already out with a rider), escrow reversed, open delivery legs cancelled,
 * riders freed, parent order re-synced, other parties notified.
 */
const cancelSubOrder = async (opts: {
  filter: QueryFilter<ISubOrder>;
  allowedFrom: SubOrderStatus[];
  by: CancelledBy;
  reason: string;
  actorUserId: string;
  syncParent?: boolean;
  /** false: the caller sends its own notice (payment window expiry) */
  notify?: boolean;
}) => {
  const now = new Date();
  const previous = await SubOrder.findOneAndUpdate(
    { ...opts.filter, status: { $in: opts.allowedFrom } },
    {
      $set: {
        status: SubOrderStatus.cancelled,
        cancellation: { by: opts.by, reason: opts.reason, at: now },
      },
      $push: {
        timeline: {
          status: SubOrderStatus.cancelled,
          note: `Cancelled by ${opts.by}: ${opts.reason}`,
          byUserId: new Types.ObjectId(opts.actorUserId),
          at: now,
        },
      },
    },
    { returnDocument: "before" },
  );
  if (!previous) {
    throw new AppError(
      httpStatus.CONFLICT,
      "ORDER_CANCEL_CONFLICT",
    );
  }

  const parcelWithRider = previous.status === SubOrderStatus.in_delivery;
  if (!parcelWithRider) {
    for (const item of previous.items) {
      if (!item.removed) {
        await Product.updateOne(
          { _id: item.productId },
          { $inc: { stockQty: item.qty, soldCount: -item.qty } },
        );
      }
    }
  }

  // Never paid: no escrow was held, nothing to reverse
  const wasUnpaid = previous.status === SubOrderStatus.pending_payment;
  if (wasUnpaid) {
    await SubOrder.updateOne({ _id: previous._id }, { settlement: SettlementStatus.cancelled });
  } else {
    await WalletServices.reverseEscrowForSubOrder(String(previous._id), opts.actorUserId);
  }

  // Paid online? The customer's money for this store goes into a refund request (admin approves).
  // Cash on delivery with the fees paid online: this store's delivery fee comes back.
  const parent = await Order.findById(previous.orderId).select("paymentMethod upfrontAmount").lean();
  const feesOnly = parent?.paymentMethod === PaymentMethod.cod;
  await RefundServices.requestRefund({
    orderId: previous.orderId,
    subOrderId: previous._id,
    amount: feesOnly ? previous.deliveryFee : previous.total,
    source: RefundSource.cancellation,
    reason: `${previous.subOrderNumber} cancelled by ${opts.by}: ${opts.reason}`,
  });

  const openLegStatuses = parcelWithRider
    ? [...NOT_PICKED_UP_LEGS, DeliveryStatus.picked_up, DeliveryStatus.in_transit]
    : NOT_PICKED_UP_LEGS;
  const openLegs = await Delivery.find({
    subOrderId: previous._id,
    status: { $in: openLegStatuses },
  }).select("status riderId");

  for (const leg of openLegs) {
    const claimed = await Delivery.updateOne(
      { _id: leg._id, status: leg.status },
      { status: DeliveryStatus.cancelled },
    );
    if (claimed.modifiedCount && leg.riderId && ACTIVE_RIDER_LEGS.includes(leg.status)) {
      await RiderProfile.updateOne(
        { _id: leg.riderId, activeDeliveryCount: { $gt: 0 } },
        { $inc: { activeDeliveryCount: -1 } },
      );
    }
  }

  if (opts.syncParent !== false) {
    await syncOrderStatus(previous.orderId);
    // Whole order cancelled: the service fee and tax go back too
    await RefundServices.requestRemainingIfCancelled(previous.orderId);
  }

  const riderIds = openLegs.flatMap((leg) => (leg.riderId ? [leg.riderId] : []));
  if (opts.notify !== false) Notify.orderCancelled(previous, opts.by, opts.reason, riderIds, !wasUnpaid);

  return SubOrder.findById(previous._id);
};

export {
  codCashBase,
  deriveOrderStatus,
  syncOrderStatus,
  cancelSubOrder,
};

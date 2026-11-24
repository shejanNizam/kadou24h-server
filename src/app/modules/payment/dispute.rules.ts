/**
 * Who can report which problem on an order (client, 2026-11-24): one place for the
 * rules, used when a dispute is filed and to tell the app what to offer.
 *
 * - A delivery problem (not received, damaged, wrong or missing item) only on a store
 *   part that was delivered. Nothing delivered → nothing can be missing.
 * - A payment problem only when money was paid online for the order.
 * - One open dispute per store part (or per whole order) at a time.
 * - The amount is what the customer paid for that part, never the order total.
 */
import { Types } from "mongoose";
import { IOrder, PaymentMethod, SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { Dispute } from "./dispute.model";
import { DisputeStatus, DisputeType } from "./payment.interface";
import { RefundServices } from "./refund.service";

export const DELIVERY_PROBLEMS = [
  DisputeType.not_received,
  DisputeType.damaged,
  DisputeType.wrong_item,
  DisputeType.missing_item,
];

interface Part {
  _id: Types.ObjectId;
  status: SubOrderStatus;
  total: number;
}

export interface DisputeTarget {
  /** null = the whole order */
  subOrderId: string | null;
  types: DisputeType[];
  /** Ceiling for each type: what the customer paid for it */
  maxAmount: Partial<Record<DisputeType, number>>;
}

/** What the customer may still report on this order (empty → no "report a problem") */
export const disputeTargets = async (order: IOrder, parts?: Part[]): Promise<DisputeTarget[]> => {
  const subOrders = parts ?? (await SubOrder.find({ orderId: order._id }).select("status total").lean<Part[]>());
  const [paidOnline, open] = await Promise.all([
    RefundServices.paidOnlineAmount(order),
    Dispute.find({ orderId: order._id, status: DisputeStatus.open }).select("subOrderId").lean(),
  ]);
  const busy = new Set(open.map((d) => (d.subOrderId ? String(d.subOrderId) : null)));
  const isCod = order.paymentMethod === PaymentMethod.cod;
  const delivered = subOrders.filter((s) => s.status === SubOrderStatus.delivered);
  const deliveredTotal = delivered.reduce((sum, s) => sum + s.total, 0);

  const target = (subOrderId: string | null, deliveryAmount: number, paymentAmount: number): DisputeTarget => {
    const maxAmount: DisputeTarget["maxAmount"] = {};
    if (deliveryAmount > 0) for (const type of DELIVERY_PROBLEMS) maxAmount[type] = deliveryAmount;
    if (paymentAmount > 0) maxAmount[DisputeType.payment] = paymentAmount;
    return { subOrderId, types: Object.keys(maxAmount) as DisputeType[], maxAmount };
  };

  const targets = [
    // The whole order: delivery problems cover the delivered parts, payment covers what was paid online
    ...(subOrders.length > 1 ? [target(null, deliveredTotal, paidOnline)] : []),
    ...subOrders.map((s) =>
      target(
        String(s._id),
        s.status === SubOrderStatus.delivered ? s.total : 0,
        // Paid online: that part's share (cash on delivery: the fees only, never more than paid)
        paidOnline > 0 && s.status !== SubOrderStatus.pending_payment ? (isCod ? paidOnline : Math.min(s.total, paidOnline)) : 0,
      ),
    ),
  ];
  return targets.filter((t) => t.types.length > 0 && !busy.has(t.subOrderId));
};

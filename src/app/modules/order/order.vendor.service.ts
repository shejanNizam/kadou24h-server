/**
 * Vendor side: sub-order lists, status changes, edits, cancellation.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Product } from "../product/product.model";
import { DeliveryStatus, EndpointKind } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { DeliveryDispatch } from "../delivery/delivery.dispatch.service";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { ISubOrderModification, SettlementStatus, SubOrderStatus } from "./order.interface";
import { Order } from "./order.model";
import { SubOrder } from "./sub_order.model";
import { TransactionType, WalletEvent, WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import { cancelSubOrder, codCashBase, syncOrderStatus } from "./order.utils";
import { Notify } from "../notification/notification.events";
import { SettingsServices } from "../settings/settings.service";
import { RefundSource } from "../payment/payment.interface";
import { RefundServices } from "../payment/refund.service";

/**
 * Vendor retrieves their assigned sub-orders.
 */
const getVendorSubOrders = async (
  vendorUserId: string,
  query: { page?: number; limit?: number; status?: string },
) => {
  const vendor = await VendorProfile.findOne({ userId: vendorUserId });
  if (!vendor) {
    throw new AppError(httpStatus.FORBIDDEN, "VENDOR_PROFILE_NOT_FOUND");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  // Unpaid online orders are not the store's yet
  const filter: Record<string, unknown> = { vendorId: vendor._id, status: { $ne: SubOrderStatus.pending_payment } };
  // One status or several, comma-separated (the app's tabs: "accepted,preparing,…")
  if (query.status) {
    const statuses = String(query.status)
      .split(",")
      .filter((s): s is SubOrderStatus => Object.values(SubOrderStatus).includes(s as SubOrderStatus))
      .filter((s) => s !== SubOrderStatus.pending_payment);
    if (!statuses.length) throw new AppError(httpStatus.BAD_REQUEST, "STATUS_INVALID");
    filter.status = { $in: statuses };
  }

  const [subOrders, total] = await Promise.all([
    SubOrder.find(filter)
      .populate("customerId", "name phone avatar")
      // Payment state on the card: an online order may still be unpaid
      .populate("orderId", "orderNumber deliveryType paymentMethod paymentStatus")
      .populate({
        path: "currentRiderId",
        select: "userId vehicle.type",
        populate: { path: "userId", select: "name avatar" },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    SubOrder.countDocuments(filter),
  ]);

  const sanitizedSubOrders = subOrders.map((so) => {
    const obj = so.toObject();
    const isActiveFulfillment = [
      SubOrderStatus.accepted,
      SubOrderStatus.preparing,
      SubOrderStatus.ready_for_pickup,
      SubOrderStatus.in_delivery,
    ].includes(so.status);

    if (!isActiveFulfillment && obj.customerId && typeof obj.customerId === "object") {
      // populated customer document
      const cust = obj.customerId as unknown as { phone?: string };
      if (cust.phone && cust.phone.length > 4) {
        cust.phone = cust.phone.slice(0, 4) + " •••• " + cust.phone.slice(-2);
      }
    }
    return obj;
  });

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: sanitizedSubOrders,
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
    throw new AppError(httpStatus.FORBIDDEN, "VENDOR_PROFILE_NOT_FOUND");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
    // Unpaid online orders are not the store's yet
    status: { $ne: SubOrderStatus.pending_payment },
  })
    .populate("customerId", "name phone avatar")
    // Rider phone stays hidden (client rule); vehicle + rating identify them at pickup
    .populate({
      path: "currentRiderId",
      select: "userId partnerType vehicle vestNumber stats",
      populate: { path: "userId", select: "name avatar" },
    });

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "SUB_ORDER_NOT_FOUND");
  }

  const parentOrder = await Order.findById(subOrder.orderId).select(
    "orderNumber addressSnapshot deliveryType specialInstructions paymentMethod paymentStatus",
  );

  // All legs up front: for intercity the vendor assigns the bus driver (leg 2)
  // before leg 1 reaches the station, so the station PIN relay works
  const deliveries = await Delivery.find({ subOrderId: subOrder._id })
    .select("legNumber legType status fromKind fromName toKind toName riderId fee pickedUpAt deliveredAt offerOpenedAt reservedUntil noRiderAlertedAt")
    .populate({ path: "riderId", select: "userId partnerType vehicle", populate: { path: "userId", select: "name avatar" } })
    .sort({ legNumber: 1 })
    .lean();

  // The store's own pickup PIN (first leg, which starts at the store), shown on
  // the order so the vendor can give it to the rider. Hidden once picked up.
  const storeLeg = await Delivery.findOne({
    subOrderId: subOrder._id,
    fromKind: EndpointKind.vendor,
    status: {
      $in: [
        DeliveryStatus.pending_assignment,
        DeliveryStatus.assigned,
        DeliveryStatus.accepted,
        DeliveryStatus.going_to_pickup,
      ],
    },
  })
    .select("+pickupPin")
    .lean();

  return {
    subOrder,
    parentOrder,
    deliveries,
    ...(storeLeg && { pickupPin: storeLeg.pickupPin }),
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
    throw new AppError(httpStatus.FORBIDDEN, "VENDOR_PROFILE_NOT_FOUND");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
    // Unpaid online orders are not the store's yet
    status: { $ne: SubOrderStatus.pending_payment },
  });

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "SUB_ORDER_NOT_FOUND");
  }

  // Allowed transitions (Vendor cannot mark in_delivery or delivered; only rider PIN verification does)
  const validTransitions: Record<SubOrderStatus, SubOrderStatus[]> = {
    [SubOrderStatus.pending_payment]: [],
    [SubOrderStatus.new]: [SubOrderStatus.accepted, SubOrderStatus.cancelled],
    [SubOrderStatus.accepted]: [
      SubOrderStatus.preparing,
      SubOrderStatus.cancelled,
    ],
    [SubOrderStatus.preparing]: [
      SubOrderStatus.ready_for_pickup,
      SubOrderStatus.cancelled,
    ],
    // Once the parcel is ready only an admin can cancel (same rule as cancelVendorSubOrder)
    [SubOrderStatus.ready_for_pickup]: [],
    [SubOrderStatus.in_delivery]: [],
    [SubOrderStatus.delivered]: [],
    [SubOrderStatus.cancelled]: [],
  };

  if (!validTransitions[subOrder.status]?.includes(newStatus)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "SUB_ORDER_TRANSITION_INVALID", { from: subOrder.status, to: newStatus },
    );
  }

  // Cancelling also restores stock, reverses escrow and frees riders
  if (newStatus === SubOrderStatus.cancelled) {
    return cancelSubOrder({
      filter: { _id: subOrder._id, vendorId: vendor._id },
      allowedFrom: [subOrder.status],
      by: "vendor",
      reason: note || "Cancelled by the store",
      actorUserId: vendorUserId,
    });
  }

  // Atomic: fails if the customer cancelled (or another update landed) meanwhile
  const updated = await SubOrder.findOneAndUpdate(
    { _id: subOrder._id, status: subOrder.status },
    {
      $set: {
        status: newStatus,
        ...(estimatedDeliveryMinutes && {
          estimatedDeliveryAt: new Date(Date.now() + estimatedDeliveryMinutes * 60 * 1000),
        }),
      },
      $push: {
        timeline: {
          status: newStatus,
          ...(note && { note }),
          byUserId: new Types.ObjectId(vendorUserId),
          at: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new AppError(
      httpStatus.CONFLICT,
      "SUB_ORDER_CONFLICT",
    );
  }

  await syncOrderStatus(updated.orderId);

  if (newStatus === SubOrderStatus.accepted) {
    Notify.orderAccepted(updated);
    // Open dispatch: nearby riders see the delivery from now on
    DeliveryDispatch.openLegsSoon(updated._id);
  }
  if (newStatus === SubOrderStatus.ready_for_pickup) Notify.orderReadyForPickup(updated);

  return updated;
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
    throw new AppError(httpStatus.FORBIDDEN, "VENDOR_PROFILE_NOT_FOUND");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
    // Unpaid online orders are not the store's yet
    status: { $ne: SubOrderStatus.pending_payment },
  });

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "SUB_ORDER_NOT_FOUND");
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
      "ORDER_ITEMS_LOCKED",
    );
  }

  const oldTotal = subOrder.total;
  const removedRecord: ISubOrderModification["removedItems"] = [];

  // Validate everything first, so a bad line changes nothing. The order can only
  // shrink: the customer agreed to (and maybe paid) the original amount.
  const plan = modifications.map((mod) => {
    const item = subOrder.items.find(
      (i) => String(i.productId) === mod.productId && !i.removed,
    );
    if (!item) {
      throw new AppError(httpStatus.BAD_REQUEST, "ORDER_ITEM_NOT_IN_ORDER");
    }
    const newQty = mod.action === "remove" ? 0 : mod.newQty;
    if (newQty === undefined) {
      throw new AppError(httpStatus.BAD_REQUEST, "NEW_QTY_REQUIRED");
    }
    if (newQty >= item.qty) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "QTY_ONLY_REDUCE", { name: item.name, qty: item.qty },
      );
    }
    return { item, newQty };
  });
  const touched = new Set(plan.map((p) => p.item));
  const leftAfter =
    subOrder.items.filter((i) => !i.removed && !touched.has(i)).length +
    plan.filter((p) => p.newQty > 0).length;
  if (leftAfter === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "ORDER_NEEDS_ONE_ITEM",
    );
  }

  for (const { item, newQty } of plan) {
    const qtyRemoved = item.qty - newQty;
    removedRecord.push({
      productId: item.productId,
      name: item.name,
      qty: qtyRemoved,
      unitPrice: item.unitPrice,
      lineTotal: item.unitPrice * qtyRemoved,
    });
    if (newQty === 0) {
      item.removed = true;
    } else {
      item.qty = newQty;
      item.lineTotal = item.unitPrice * newQty;
    }
    // Back on the shelf
    await Product.findByIdAndUpdate(item.productId, {
      $inc: { stockQty: qtyRemoved, soldCount: -qtyRemoved },
    });
  }

  // Recalculate subtotal of active items
  const activeItems = subOrder.items.filter((i) => !i.removed);
  const newSubtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);

  // Same commission rule as checkout (rate stored on the sub-order, minimum from settings)
  const settings = await SettingsServices.getSettings();
  const commissionRate = subOrder.commissionRate ?? settings.commission?.rate ?? 10;
  const commissionMin = settings.commission?.min ?? 1000;
  const rawCommission = Math.round((commissionRate / 100) * newSubtotal);
  const cappedMin = Math.min(commissionMin, Math.round(newSubtotal * 0.9));
  const newCommissionAmount = Math.min(
    Math.max(rawCommission, cappedMin),
    Math.round(newSubtotal * 0.9),
  );
  const newVendorEarning = Math.max(0, newSubtotal - newCommissionAmount);
  const newTotal = Math.max(0, newSubtotal + subOrder.deliveryFee - (subOrder.discountShare ?? 0));
  const refundAmount = Math.max(0, oldTotal - newTotal);

  const oldVendorEarning = subOrder.vendorEarning;
  const earningDiff = oldVendorEarning - newVendorEarning;

  // Synchronize vendor escrow with wallet
  if (earningDiff > 0 && subOrder.settlement === SettlementStatus.held) {
    const vendorProfile = await VendorProfile.findById(subOrder.vendorId);
    if (vendorProfile) {
      const vendorWallet = await WalletServices.ensureWallet(
        vendorProfile.userId,
        WalletMode.vendor,
      );
      await WalletServices.recordTransaction({
        walletId: vendorWallet._id,
        type: TransactionType.earning_held_reversed,
        amount: earningDiff,
        subOrderId: subOrder._id,
        note: `Escrow reduced due to sub-order items modification (${subOrder.subOrderNumber})`,
        event: WalletEvent.sale_changed,
        eventParams: { order: subOrder.subOrderNumber },
        createdBy: vendorUserId,
      });
    }
  } else if (earningDiff < 0 && subOrder.settlement === SettlementStatus.held) {
    const vendorProfile = await VendorProfile.findById(subOrder.vendorId);
    if (vendorProfile) {
      const vendorWallet = await WalletServices.ensureWallet(
        vendorProfile.userId,
        WalletMode.vendor,
      );
      await WalletServices.recordTransaction({
        walletId: vendorWallet._id,
        type: TransactionType.earning_held,
        amount: Math.abs(earningDiff),
        subOrderId: subOrder._id,
        note: `Escrow increased due to sub-order items modification (${subOrder.subOrderNumber})`,
        event: WalletEvent.sale_changed,
        eventParams: { order: subOrder.subOrderNumber },
        createdBy: vendorUserId,
      });
    }
  }

  if (subOrder.codAmountToCollect !== undefined) {
    // The cash follows the products; an extra it carries (older COD orders: the first
    // store's service fee and tax) is kept
    const parent = await Order.findById(subOrder.orderId).select("upfrontAmount").lean();
    const feesOnline = Boolean(parent?.upfrontAmount);
    const extra = Math.max(0, subOrder.codAmountToCollect - codCashBase(subOrder, feesOnline));
    subOrder.codAmountToCollect =
      codCashBase({ subtotal: newSubtotal, total: newTotal, discountShare: subOrder.discountShare }, feesOnline) + extra;
  }
  subOrder.subtotal = newSubtotal;
  subOrder.commissionAmount = newCommissionAmount;
  subOrder.vendorEarning = newVendorEarning;
  subOrder.total = newTotal;

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
    ...(reason && { note: reason }),
    byUserId: new Types.ObjectId(vendorUserId),
    at: new Date(),
  });

  await subOrder.save();
  Notify.orderModified(subOrder, newTotal);
  // Paid online: the difference goes into a refund request (admin approves; never for COD)
  if (refundAmount > 0) {
    await RefundServices.requestRefund({
      orderId: subOrder.orderId,
      subOrderId: subOrder._id,
      amount: refundAmount,
      source: RefundSource.modification,
      reason: `${subOrder.subOrderNumber} changed by the store: ${reason || "items removed"}`,
      by: "vendor",
      ...(reason && { note: reason }),
    });
  }

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
    throw new AppError(httpStatus.FORBIDDEN, "VENDOR_PROFILE_NOT_FOUND");
  }

  const subOrder = await SubOrder.findOne({
    _id: subOrderId,
    vendorId: vendor._id,
    // Unpaid online orders are not the store's yet
    status: { $ne: SubOrderStatus.pending_payment },
  });

  if (!subOrder) {
    throw new AppError(httpStatus.NOT_FOUND, "SUB_ORDER_NOT_FOUND");
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
      "SUB_ORDER_CANCEL_TOO_LATE",
    );
  }

  return cancelSubOrder({
    filter: { _id: subOrder._id, vendorId: vendor._id },
    allowedFrom: [SubOrderStatus.new, SubOrderStatus.accepted, SubOrderStatus.preparing],
    by: "vendor",
    reason,
    actorUserId: vendorUserId,
  });
};

export {
  getVendorSubOrders,
  getVendorSubOrderDetail,
  updateSubOrderStatus,
  modifySubOrderItems,
  cancelVendorSubOrder,
};

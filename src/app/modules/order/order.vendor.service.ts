/**
 * Vendor side: sub-order lists, status changes, edits, cancellation.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Product } from "../product/product.model";
import { Delivery } from "../delivery/delivery.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { ISubOrderModification, SettlementStatus, SubOrderStatus } from "./order.interface";
import { Order } from "./order.model";
import { SubOrder } from "./sub_order.model";
import { TransactionType, WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import { cancelSubOrder, syncOrderStatus } from "./order.utils";
import { Notify } from "../notification/notification.events";

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

  // All legs up front: for intercity the vendor assigns the bus driver (leg 2)
  // before leg 1 reaches the station, so the station PIN relay works
  const deliveries = await Delivery.find({ subOrderId: subOrder._id })
    .select("legNumber legType status fromKind fromName toKind toName riderId")
    .populate({ path: "riderId", select: "userId partnerType vehicle", populate: { path: "userId", select: "name avatar" } })
    .sort({ legNumber: 1 })
    .lean();

  return {
    subOrder,
    parentOrder,
    deliveries,
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

  // Allowed transitions (Vendor cannot mark in_delivery or delivered; only rider PIN verification does)
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
    // Once the parcel is ready only an admin can cancel (same rule as cancelVendorSubOrder)
    [SubOrderStatus.ready_for_pickup]: [],
    [SubOrderStatus.in_delivery]: [],
    [SubOrderStatus.delivered]: [],
    [SubOrderStatus.cancelled]: [],
  };

  if (!validTransitions[subOrder.status]?.includes(newStatus)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot transition sub-order from "${subOrder.status}" to "${newStatus}"`,
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
          note: note || `Status updated to ${newStatus}`,
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
      "This order was just updated (it may have been cancelled). Please refresh.",
    );
  }

  await syncOrderStatus(updated.orderId);

  if (newStatus === SubOrderStatus.accepted) Notify.orderAccepted(updated);
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

  // Recalculate commission safely
  const commissionRate = subOrder.commissionRate || 10;
  const rawCommission = Math.round((commissionRate / 100) * newSubtotal);
  const cappedMin = Math.min(1000, Math.round(newSubtotal * 0.9));
  const newCommissionAmount = Math.min(
    Math.max(rawCommission, cappedMin),
    Math.round(newSubtotal * 0.9),
  );
  const newVendorEarning = Math.max(0, newSubtotal - newCommissionAmount);
  const newTotal = newSubtotal + subOrder.deliveryFee - subOrder.discountShare;
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
        createdBy: vendorUserId,
      });
    }
  }

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

import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { emitToUser } from "../../../socket/socket";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { PaymentStatus as OrderPaymentStatus } from "../order/order.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { TransactionType, WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import {
  DisputeStatus,
  IPayment,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
} from "./payment.interface";
import { Payment } from "./payment.model";
import { Refund } from "./refund.model";
import { Dispute } from "./dispute.model";

/**
 * Initiates a payment.
 * Supports idempotency, validates reference entity, and in test/dev simulates immediate gateway processing.
 */
const initiatePayment = async (
  payerId: string,
  payload: {
    purpose: PaymentPurpose;
    refId: string;
    contextId?: string;
    method: PaymentMethod;
    provider?: string;
    idempotencyKey?: string;
  },
) => {
  // Idempotency check
  if (payload.idempotencyKey) {
    const existing = await Payment.findOne({
      idempotencyKey: payload.idempotencyKey,
    });
    if (existing) {
      return existing;
    }
  }

  let amount = 0;

  if (payload.purpose === PaymentPurpose.order) {
    const order = await Order.findById(payload.refId);
    if (!order) throw new AppError(httpStatus.NOT_FOUND, "Order not found");

    if (String(order.customerId) !== payerId) {
      throw new AppError(httpStatus.FORBIDDEN, "Not authorized to pay for this order");
    }

    if (order.paymentStatus === OrderPaymentStatus.paid) {
      throw new AppError(httpStatus.BAD_REQUEST, "Order is already paid");
    }

    amount = order.total;
  } else if (payload.purpose === PaymentPurpose.job_publish) {
    // 5,000 GNF fixed publishing fee
    amount = 5000;
  } else if (payload.purpose === PaymentPurpose.cv_unlock) {
    // 10,000 GNF fixed candidate unlock fee
    amount = 10000;
  } else if (payload.purpose === PaymentPurpose.subscription) {
    amount = 50000; // standard subscription default
  } else {
    amount = 1000;
  }

  // Generate provider reference if none
  const providerRef = `${payload.method.toUpperCase()}_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  // Create payment record
  const payment = await Payment.create({
    payerId: new Types.ObjectId(payerId),
    purpose: payload.purpose,
    refId: payload.refId,
    contextId: payload.contextId,
    method: payload.method,
    provider: payload.provider || payload.method,
    amount,
    status: PaymentStatus.pending,
    providerRef,
    idempotencyKey: payload.idempotencyKey,
  });

  // Simulated immediate gateway processing for OM, Momo, Card, or COD
  if (
    [
      PaymentMethod.orange_money,
      PaymentMethod.mobile_money,
      PaymentMethod.card,
    ].includes(payload.method)
  ) {
    payment.status = PaymentStatus.success;
    payment.paidAt = new Date();
    payment.raw = { simulated: true, gateway: payload.method, success: true };
    await payment.save();

    if (payload.purpose === PaymentPurpose.order) {
      await Order.findByIdAndUpdate(payload.refId, {
        paymentStatus: OrderPaymentStatus.paid,
      });
    }

    emitToUser(payerId, "payment:successful", {
      paymentId: payment._id,
      amount: payment.amount,
      purpose: payment.purpose,
      refId: payment.refId,
    });
  }

  return payment;
};

/**
 * Webhook handler for external gateway notifications (Orange Money, MTN Momo).
 */
const handleWebhook = async (payload: {
  idempotencyKey?: string;
  providerRef?: string;
  paymentId?: string;
  status: "success" | "failed";
  raw?: Record<string, unknown>;
}) => {
  const filter: Record<string, unknown> = {};
  if (payload.paymentId) filter._id = payload.paymentId;
  else if (payload.idempotencyKey) filter.idempotencyKey = payload.idempotencyKey;
  else if (payload.providerRef) filter.providerRef = payload.providerRef;
  else {
    throw new AppError(httpStatus.BAD_REQUEST, "paymentId, idempotencyKey, or providerRef is required");
  }

  const payment = await Payment.findOne(filter);
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, "Payment record not found");

  if (payment.status === PaymentStatus.success) {
    return payment; // Already handled idempotently
  }

  if (payload.status === "success") {
    payment.status = PaymentStatus.success;
    payment.paidAt = new Date();
    if (payload.raw) payment.raw = payload.raw;
    await payment.save();

    if (payment.purpose === PaymentPurpose.order) {
      await Order.findByIdAndUpdate(payment.refId, {
        paymentStatus: OrderPaymentStatus.paid,
      });
    }

    emitToUser(String(payment.payerId), "payment:successful", {
      paymentId: payment._id,
      amount: payment.amount,
      purpose: payment.purpose,
    });
  } else {
    payment.status = PaymentStatus.failed;
    if (payload.raw) payment.raw = payload.raw;
    await payment.save();
  }

  return payment;
};

/**
 * Admin issues a refund for an order.
 * If vendor earnings were already released, writes refund_deduction to vendor ledger.
 */
const issueRefund = async (
  adminUserId: string,
  payload: {
    orderId: string;
    subOrderId?: string;
    amount: number;
    reason: string;
    notes?: string;
  },
) => {
  const order = await Order.findById(payload.orderId);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, "Order not found");

  if (payload.amount > order.total) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Refund amount (${payload.amount} GNF) cannot exceed order total (${order.total} GNF)`,
    );
  }

  // Find linked payment
  const payment = await Payment.findOne({
    purpose: PaymentPurpose.order,
    refId: order._id,
    status: PaymentStatus.success,
  });

  const refund = await Refund.create({
    orderId: order._id,
    subOrderId: payload.subOrderId ? new Types.ObjectId(payload.subOrderId) : undefined,
    paymentId: payment?._id,
    customerId: order.customerId,
    amount: payload.amount,
    reason: payload.reason,
    notes: payload.notes,
    status: RefundStatus.completed,
    issuedBy: new Types.ObjectId(adminUserId),
  });

  // Update order payment status
  const existingRefunds = await Refund.find({
    orderId: order._id,
    status: RefundStatus.completed,
  });
  const totalRefunded = existingRefunds.reduce((sum, r) => sum + r.amount, 0);

  if (totalRefunded >= order.total) {
    order.paymentStatus = OrderPaymentStatus.refunded;
  } else {
    order.paymentStatus = OrderPaymentStatus.partially_refunded;
  }
  await order.save();

  // If subOrderId specified or available, check if escrow was already released to vendor
  if (payload.subOrderId) {
    const subOrder = await SubOrder.findById(payload.subOrderId);
    if (subOrder && subOrder.settlement === "released") {
      const vendor = await VendorProfile.findById(subOrder.vendorId);
      if (vendor) {
        const vendorWallet = await WalletServices.getMyWallet(
          String(vendor.userId),
          WalletMode.vendor,
        );

        await WalletServices.recordTransaction({
          walletId: vendorWallet._id,
          type: TransactionType.refund_deduction,
          amount: payload.amount,
          subOrderId: subOrder._id,
          note: `Refund deduction for ${subOrder.subOrderNumber}: ${payload.reason}`,
          createdBy: adminUserId,
        });
      }
    }
  }

  emitToUser(String(order.customerId), "refund:issued", {
    refundId: refund._id,
    orderId: order._id,
    amount: payload.amount,
    reason: payload.reason,
  });

  return refund;
};

/**
 * Customer files a dispute for an order or sub-order.
 */
const createDispute = async (
  customerId: string,
  payload: {
    orderId: string;
    subOrderId?: string;
    amount?: number;
    reason: string;
    notes?: string;
  },
) => {
  const order = await Order.findById(payload.orderId);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, "Order not found");

  if (String(order.customerId) !== customerId) {
    throw new AppError(httpStatus.FORBIDDEN, "Not authorized to dispute this order");
  }

  const dispute = await Dispute.create({
    orderId: order._id,
    subOrderId: payload.subOrderId ? new Types.ObjectId(payload.subOrderId) : undefined,
    customerId: new Types.ObjectId(customerId),
    amount: payload.amount || order.total,
    reason: payload.reason,
    notes: payload.notes,
    status: DisputeStatus.open,
  });

  return dispute;
};

/**
 * Admin resolves a dispute (with optional refund).
 */
const resolveDispute = async (
  adminUserId: string,
  disputeId: string,
  payload: {
    status: DisputeStatus.resolved | DisputeStatus.rejected;
    adminResolution: string;
    notes?: string;
    issueRefund?: boolean;
    refundAmount?: number;
  },
) => {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new AppError(httpStatus.NOT_FOUND, "Dispute not found");

  if (dispute.status !== DisputeStatus.open) {
    throw new AppError(httpStatus.BAD_REQUEST, `Dispute has already been ${dispute.status}`);
  }

  dispute.status = payload.status;
  dispute.adminResolution = payload.adminResolution;
  if (payload.notes) dispute.notes = payload.notes;
  dispute.resolvedBy = new Types.ObjectId(adminUserId);
  dispute.resolvedAt = new Date();
  await dispute.save();

  // If resolved and refund is requested
  if (payload.status === DisputeStatus.resolved && payload.issueRefund) {
    const refundAmount = payload.refundAmount || dispute.amount || 1;
    await issueRefund(adminUserId, {
      orderId: String(dispute.orderId),
      subOrderId: dispute.subOrderId ? String(dispute.subOrderId) : undefined,
      amount: refundAmount,
      reason: `Dispute resolved: ${payload.adminResolution}`,
    });
  }

  emitToUser(String(dispute.customerId), "dispute:resolved", {
    disputeId: dispute._id,
    status: dispute.status,
    resolution: dispute.adminResolution,
  });

  return dispute;
};

/**
 * Listing and query functions
 */
const getMyPayments = async (
  payerId: string,
  query: { page?: number; limit?: number; purpose?: PaymentPurpose },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    payerId: new Types.ObjectId(payerId),
  };
  if (query.purpose) filter.purpose = query.purpose;

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Payment.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: payments,
  };
};

const getMyDisputes = async (
  customerId: string,
  query: { page?: number; limit?: number; status?: DisputeStatus },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    customerId: new Types.ObjectId(customerId),
  };
  if (query.status) filter.status = query.status;

  const [disputes, total] = await Promise.all([
    Dispute.find(filter)
      .populate("orderId", "orderNumber total paymentStatus")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Dispute.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: disputes,
  };
};

const getAllPaymentsAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: PaymentStatus;
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.purpose) filter.purpose = query.purpose;
  if (query.method) filter.method = query.method;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate("payerId", "name phone email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Payment.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: payments,
  };
};

const getAllRefundsAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: RefundStatus;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const [refunds, total] = await Promise.all([
    Refund.find(filter)
      .populate("customerId", "name phone email")
      .populate("orderId", "orderNumber total")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Refund.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: refunds,
  };
};

const getAllDisputesAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: DisputeStatus;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const [disputes, total] = await Promise.all([
    Dispute.find(filter)
      .populate("customerId", "name phone email")
      .populate("orderId", "orderNumber total paymentStatus")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Dispute.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: disputes,
  };
};

export const PaymentServices = {
  initiatePayment,
  handleWebhook,
  issueRefund,
  createDispute,
  resolveDispute,
  getMyPayments,
  getMyDisputes,
  getAllPaymentsAdmin,
  getAllRefundsAdmin,
  getAllDisputesAdmin,
};

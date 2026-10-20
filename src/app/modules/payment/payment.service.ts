import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { emitToUser } from "../../../socket/socket";
import { Notify } from "../notification/notification.events";
import { AppMode } from "../user/user.interface";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { PaymentStatus as OrderPaymentStatus } from "../order/order.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { TransactionType, WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import { SettingsServices } from "../settings/settings.service";
import { SubscriptionPlan } from "../subscription/subscription_plan.model";
import { UserSubscription } from "../subscription/user_subscription.model";
import { SubscriptionStatus } from "../subscription/subscription.interface";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { Job } from "../job/job.model";
import { ApplicationStatus, JobStatus } from "../job/job.interface";
import { JobApplication } from "../job/job_application.model";
import {
  DisputeStatus,
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
 * Supports secure idempotency, validates reference entity, and uses dynamic settings pricing.
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
  // 1. Secure Idempotency check: MUST belong to the same payer
  if (payload.idempotencyKey) {
    const existing = await Payment.findOne({
      idempotencyKey: payload.idempotencyKey,
    });
    if (existing) {
      if (String(existing.payerId) !== String(payerId)) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Idempotency key belongs to another user account",
        );
      }
      return existing;
    }
  }

  const settings = await SettingsServices.getSettings();
  let amount: number;

  if (payload.purpose === PaymentPurpose.order) {
    const order = await Order.findById(payload.refId);
    if (!order) throw new AppError(httpStatus.NOT_FOUND, "Order not found");

    if (String(order.customerId) !== String(payerId)) {
      throw new AppError(httpStatus.FORBIDDEN, "Not authorized to pay for this order");
    }

    if (order.paymentStatus === OrderPaymentStatus.paid) {
      throw new AppError(httpStatus.BAD_REQUEST, "Order is already paid");
    }
    if (order.paymentMethod === "cod") {
      throw new AppError(httpStatus.BAD_REQUEST, "Cash on delivery orders are paid to the rider");
    }
    if (order.status === "cancelled") {
      throw new AppError(httpStatus.BAD_REQUEST, "This order was cancelled");
    }

    amount = order.total;
  } else if (payload.purpose === PaymentPurpose.job_publish) {
    amount = settings.pricing?.jobPublishFee ?? 5000;
  } else if (payload.purpose === PaymentPurpose.cv_unlock) {
    // Client specified 5,000 GNF for candidate CV unlock
    amount = settings.pricing?.cvUnlockFee ?? 5000;
  } else if (payload.purpose === PaymentPurpose.subscription) {
    const plan = await SubscriptionPlan.findById(payload.refId);
    if (!plan || !plan.isActive) {
      throw new AppError(httpStatus.NOT_FOUND, "Active subscription plan not found");
    }
    amount = plan.price;
  } else if (payload.purpose === PaymentPurpose.spontaneous_application) {
    amount = settings.pricing?.spontaneousApplicationFee ?? 1000;
  } else {
    amount = 1000;
  }

  // Generate provider reference
  const providerRef = `${payload.method.toUpperCase()}_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  // Create payment record in PENDING status (no fake immediate success)
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

  return payment;
};

/**
 * Webhook handler for external gateway notifications (Orange Money, MTN Momo, Stripe).
 * Securely verifies payment, transitions status, and triggers downstream fulfillment.
 */
const handleWebhook = async (payload: {
  idempotencyKey?: string;
  providerRef?: string;
  paymentId?: string;
  status: "success" | "failed";
  amount?: number;
  raw?: Record<string, unknown>;
}) => {
  const filter: Record<string, unknown> = {};
  if (payload.paymentId) filter._id = payload.paymentId;
  else if (payload.idempotencyKey) filter.idempotencyKey = payload.idempotencyKey;
  else if (payload.providerRef) filter.providerRef = payload.providerRef;
  else {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "paymentId, idempotencyKey, or providerRef is required",
    );
  }

  const payment = await Payment.findOne(filter);
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, "Payment record not found");

  if (payment.status === PaymentStatus.success) {
    return payment; // Already handled idempotently
  }

  // The gateway must have collected exactly what we asked for
  if (
    payload.status === "success" &&
    payload.amount !== undefined &&
    payload.amount !== payment.amount
  ) {
    payment.status = PaymentStatus.failed;
    payment.raw = {
      ...(payload.raw ?? {}),
      rejectedReason: "amount_mismatch",
      reportedAmount: payload.amount,
    };
    await payment.save();
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Amount mismatch: expected ${payment.amount} GNF, gateway reported ${payload.amount} GNF`,
    );
  }

  if (payload.status === "success") {
    payment.status = PaymentStatus.success;
    payment.paidAt = new Date();
    if (payload.raw) payment.raw = payload.raw;
    await payment.save();

    // 1. Order fulfillment
    if (payment.purpose === PaymentPurpose.order) {
      await Order.findByIdAndUpdate(payment.refId, {
        paymentStatus: OrderPaymentStatus.paid,
      });
    }

    // 2. Job publish fulfillment
    if (payment.purpose === PaymentPurpose.job_publish) {
      await Job.findByIdAndUpdate(payment.refId, {
        status: JobStatus.published,
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        publishPaymentId: payment._id,
      });
    }

    // 3. Subscription fulfillment
    if (payment.purpose === PaymentPurpose.subscription) {
      const sub = await UserSubscription.findOneAndUpdate(
        { paymentId: payment._id },
        { status: SubscriptionStatus.active },
        { new: true },
      );
      if (sub && sub.planSnapshot?.features?.includes("cv_visibility")) {
        await ProfessionalProfile.findOneAndUpdate(
          { userId: payment.payerId },
          { $set: { cvVisible: true, visibleUntil: sub.endsAt } },
          { upsert: true },
        );
      }
    }

    // 4. CV unlock: nothing to update — access is checked against this recruiter's
    //    successful cv_unlock payments (see JobServices.getUnlockedApplicantIds)

    // 5. Paid spontaneous application: only now does it reach the vendor
    if (payment.purpose === PaymentPurpose.spontaneous_application) {
      const application = await JobApplication.findOneAndUpdate(
        { _id: payment.refId, status: ApplicationStatus.pending_payment },
        { $set: { status: ApplicationStatus.applied } },
        { returnDocument: "after" },
      );
      if (application?.targetVendorId) {
        const vendor = await VendorProfile.findById(application.targetVendorId).select("userId");
        if (vendor) {
          emitToUser(String(vendor.userId), "job_application:new", {
            vendorId: vendor._id,
            applicationId: application._id,
            kind: application.kind,
          });
          Notify.applicationUpdate(
            vendor.userId,
            AppMode.vendor,
            {
              fr: "Nouvelle candidature spontanée reçue.",
              en: "New spontaneous application received.",
            },
            { applicationId: String(application._id) },
          );
        }
      }
    }

    emitToUser(String(payment.payerId), "payment:successful", {
      paymentId: payment._id,
      amount: payment.amount,
      purpose: payment.purpose,
      refId: payment.refId,
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

  // Only money the customer actually paid can go back
  if (order.paymentStatus === OrderPaymentStatus.unpaid) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This order has not been paid (COD orders are paid at delivery) — nothing to refund. Cancel it instead.",
    );
  }

  const previous = await Refund.aggregate<{ total: number }>([
    { $match: { orderId: order._id, status: RefundStatus.completed } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const alreadyRefunded = previous[0]?.total ?? 0;
  const refundable = order.total - alreadyRefunded;
  if (payload.amount > refundable) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Refund amount (${payload.amount} GNF) exceeds what is left to refund (${refundable} GNF of ${order.total} GNF)`,
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
  const existing = await Dispute.findById(disputeId);
  if (!existing) throw new AppError(httpStatus.NOT_FOUND, "Dispute not found");
  if (existing.status !== DisputeStatus.open) {
    throw new AppError(httpStatus.BAD_REQUEST, `Dispute has already been ${existing.status}`);
  }

  const withRefund = payload.status === DisputeStatus.resolved && payload.issueRefund;
  const refundAmount = payload.refundAmount ?? existing.amount;
  if (withRefund && !refundAmount) {
    throw new AppError(httpStatus.BAD_REQUEST, "Enter the refund amount");
  }

  // Claim it atomically — two admins cannot resolve (and refund) the same dispute
  const dispute = await Dispute.findOneAndUpdate(
    { _id: disputeId, status: DisputeStatus.open },
    {
      $set: {
        status: payload.status,
        adminResolution: payload.adminResolution,
        ...(payload.notes && { notes: payload.notes }),
        resolvedBy: new Types.ObjectId(adminUserId),
        resolvedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!dispute) {
    throw new AppError(httpStatus.CONFLICT, "This dispute was just handled by someone else");
  }

  if (withRefund) {
    try {
      await issueRefund(adminUserId, {
        orderId: String(dispute.orderId),
        subOrderId: dispute.subOrderId ? String(dispute.subOrderId) : undefined,
        amount: refundAmount as number,
        reason: `Dispute resolved: ${payload.adminResolution}`,
      });
    } catch (error) {
      // No refund → the dispute is not resolved either; reopen it
      await Dispute.updateOne(
        { _id: dispute._id },
        { $set: { status: DisputeStatus.open }, $unset: { adminResolution: 1, resolvedBy: 1, resolvedAt: 1 } },
      );
      throw error;
    }
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: payments,
  };
};

/** One of my payments — the app polls it on the "payment pending" screen. */
const getMyPayment = async (payerId: string, paymentId: string) => {
  if (!Types.ObjectId.isValid(paymentId)) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment record not found");
  }
  const payment = await Payment.findOne({ _id: paymentId, payerId }).select("-raw");
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, "Payment record not found");
  return payment;
};

/**
 * Development only: no gateway is connected yet, so the app can finish its own
 * pending payment the way the gateway webhook would. Disabled in production.
 */
const devConfirmPayment = async (
  payerId: string,
  paymentId: string,
  status: "success" | "failed",
) => {
  const payment = await getMyPayment(payerId, paymentId);
  return handleWebhook({ paymentId: String(payment._id), status, amount: payment.amount });
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
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
  getMyPayment,
  devConfirmPayment,
  getMyDisputes,
  getAllPaymentsAdmin,
  getAllRefundsAdmin,
  getAllDisputesAdmin,
};

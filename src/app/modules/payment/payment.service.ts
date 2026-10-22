import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { emitToUser } from "../../../socket/socket";
import { Notify } from "../notification/notification.events";
import { RefundServices } from "./refund.service";
import { RefundSource } from "./payment.interface";
import { AppMode } from "../user/user.interface";
import { Order } from "../order/order.model";
import { OrderPaymentServices } from "../order/order.payment.service";
import { PaymentStatus as OrderPaymentStatus } from "../order/order.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { SubscriptionPlan } from "../subscription/subscription_plan.model";
import { UserSubscription } from "../subscription/user_subscription.model";
import { PlanAudience, SubscriptionStatus } from "../subscription/subscription.interface";
import { extendWorkerListing } from "../professional_profile/worker_listing";
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

  // Only goods are paid at the door: fees (job, CV, subscription…) are paid online
  if (payload.purpose !== PaymentPurpose.order && payload.method === PaymentMethod.cod) {
    throw new AppError(httpStatus.BAD_REQUEST, "This payment can only be made online (Orange Money, Mobile Money or card)");
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
    if (order.paymentDueAt && order.paymentDueAt.getTime() <= Date.now()) {
      throw new AppError(httpStatus.BAD_REQUEST, "The time to pay for this order is over. It will be cancelled and the items put back in your cart.");
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

    // 1. Order fulfillment: now the stores receive it (or a refund if it was cancelled meanwhile)
    if (payment.purpose === PaymentPurpose.order) {
      await OrderPaymentServices.confirmOrderPaid(String(payment.refId));
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
      // The period starts when the money arrives; a renewal while still
      // subscribed starts when the current period ends (no overlap, no loss)
      const plan = await SubscriptionPlan.findById(payment.refId);
      const now = new Date();
      const current = await UserSubscription.findOne({
        userId: payment.payerId,
        status: SubscriptionStatus.active,
        endsAt: { $gt: now },
      }).sort({ endsAt: -1 });
      const startsAt = current?.endsAt ?? now;
      const endsAt = new Date(startsAt.getTime() + (plan?.durationDays ?? 30) * 24 * 60 * 60 * 1000);

      let sub = await UserSubscription.findOneAndUpdate(
        { paymentId: payment._id },
        { status: SubscriptionStatus.active, startsAt, endsAt },
        { new: true },
      );
      // A retried payment (the payment screen's "try again") has no subscription yet
      if (!sub && plan) {
        sub = await UserSubscription.create({
          userId: payment.payerId,
          planId: plan._id,
          planSnapshot: { name: plan.name, price: plan.price, features: plan.features },
          status: SubscriptionStatus.active,
          startsAt,
          endsAt,
          paymentId: payment._id,
        });
      }
      if (sub && sub.planSnapshot?.features?.includes("cv_visibility")) {
        await ProfessionalProfile.findOneAndUpdate(
          { userId: payment.payerId },
          { $set: { cvVisible: true, visibleUntil: sub.endsAt } },
          { upsert: true },
        );
      }
      // A service-provider plan keeps the worker visible to customers (client, 2026-10-22)
      if (sub && plan?.audience === PlanAudience.service_provider) {
        await extendWorkerListing(payment.payerId, plan.durationDays);
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

/** Admin refund by hand (already approved). Rules live in refund.service. */
const issueRefund = (adminUserId: string, payload: Parameters<typeof RefundServices.issueRefund>[1]) =>
  RefundServices.issueRefund(adminUserId, payload);

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
        source: RefundSource.dispute,
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
      .populate("orderId", "orderNumber total paymentMethod paymentStatus status")
      .populate("lines.subOrderId", "subOrderNumber")
      .populate("issuedBy", "name")
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

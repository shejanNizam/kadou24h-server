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
import { extendRideAccess } from "../rider_profile/ride_access";
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
import { gatewayForWebhook, isDemoPayments, paymentGateway } from "./gateway";
import type { WebhookRequest } from "./gateway/gateway.interface";
import { User } from "../user/user.model";

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
          "IDEMPOTENCY_KEY_CONFLICT",
        );
      }
      return existing;
    }
  }

  // Only goods are paid at the door: fees (job, CV, subscription…) are paid online
  if (payload.purpose !== PaymentPurpose.order && payload.method === PaymentMethod.cod) {
    throw new AppError(httpStatus.BAD_REQUEST, "PAYMENT_ONLINE_ONLY");
  }

  const settings = await SettingsServices.getSettings();
  let amount: number;

  if (payload.purpose === PaymentPurpose.order) {
    const order = await Order.findById(payload.refId);
    if (!order) throw new AppError(httpStatus.NOT_FOUND, "ORDER_NOT_FOUND");

    if (String(order.customerId) !== String(payerId)) {
      throw new AppError(httpStatus.FORBIDDEN, "ORDER_PAY_FORBIDDEN");
    }

    if (order.paymentStatus === OrderPaymentStatus.paid) {
      throw new AppError(httpStatus.BAD_REQUEST, "ORDER_ALREADY_PAID");
    }
    const isCod = order.paymentMethod === "cod";
    // Older COD orders: everything is paid in cash
    if (isCod && !order.upfrontAmount) {
      throw new AppError(httpStatus.BAD_REQUEST, "COD_PAID_TO_RIDER");
    }
    if (isCod && order.feesPaidAt) {
      throw new AppError(httpStatus.BAD_REQUEST, "FEES_ALREADY_PAID");
    }
    if (isCod && payload.method === PaymentMethod.cod) {
      throw new AppError(httpStatus.BAD_REQUEST, "FEES_PAY_ONLINE");
    }
    if (order.status === "cancelled") {
      throw new AppError(httpStatus.BAD_REQUEST, "ORDER_WAS_CANCELLED");
    }
    if (order.paymentDueAt && order.paymentDueAt.getTime() <= Date.now()) {
      throw new AppError(httpStatus.BAD_REQUEST, "PAYMENT_TIME_OVER");
    }

    // COD: the service fee, tax and delivery now; the products in cash to the riders
    amount = isCod ? order.upfrontAmount! : order.total;
  } else if (payload.purpose === PaymentPurpose.job_publish) {
    amount = settings.pricing?.jobPublishFee ?? 5000;
  } else if (payload.purpose === PaymentPurpose.cv_unlock) {
    // Client specified 5,000 GNF for candidate CV unlock
    amount = settings.pricing?.cvUnlockFee ?? 5000;
  } else if (payload.purpose === PaymentPurpose.subscription) {
    const plan = await SubscriptionPlan.findById(payload.refId);
    if (!plan || !plan.isActive) {
      throw new AppError(httpStatus.NOT_FOUND, "SUBSCRIPTION_PLAN_NOT_FOUND");
    }
    amount = plan.price;
  } else if (payload.purpose === PaymentPurpose.spontaneous_application) {
    amount = settings.pricing?.spontaneousApplicationFee ?? 1000;
  } else {
    amount = 1000;
  }

  // Fails early (503) when live payments have no gateway configured
  const gateway = paymentGateway();

  // Create payment record in PENDING status (no fake immediate success)
  const payment = await Payment.create({
    payerId: new Types.ObjectId(payerId),
    purpose: payload.purpose,
    refId: payload.refId,
    contextId: payload.contextId,
    method: payload.method,
    provider: gateway.name,
    amount,
    status: PaymentStatus.pending,
    idempotencyKey: payload.idempotencyKey,
  });

  // The aggregator's transaction + the page the app opens to pay
  try {
    const payer = await User.findById(payerId).select("name phone email").lean();
    const checkout = await gateway.createCheckout({
      paymentId: String(payment._id),
      amount,
      currency: "GNF",
      method: payload.method,
      description: `Kadou24h ${payload.purpose.replace(/_/g, " ")}`,
      payer: { name: payer?.name, phone: payer?.phone, email: payer?.email },
    });
    payment.providerRef = checkout.providerRef;
    payment.checkoutUrl = checkout.checkoutUrl;
    await payment.save();
  } catch (err) {
    payment.status = PaymentStatus.failed;
    payment.raw = { rejectedReason: "checkout_failed", message: err instanceof Error ? err.message : String(err) };
    await payment.save();
    throw new AppError(httpStatus.BAD_GATEWAY, "PAYMENT_UNAVAILABLE");
  }

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
      "PAYMENT_LOOKUP_REQUIRED",
    );
  }

  const payment = await Payment.findOne(filter);
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND");

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
      "PAYMENT_AMOUNT_MISMATCH", { expected: payment.amount, reported: payload.amount },
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
      // A moto-driver plan keeps the rider receiving passengers (client, 2026-10-23)
      if (sub && plan?.audience === PlanAudience.moto_driver) {
        await extendRideAccess(payment.payerId, plan.durationDays);
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
  if (!order) throw new AppError(httpStatus.NOT_FOUND, "ORDER_NOT_FOUND");

  if (String(order.customerId) !== customerId) {
    throw new AppError(httpStatus.FORBIDDEN, "DISPUTE_FORBIDDEN");
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
  if (!existing) throw new AppError(httpStatus.NOT_FOUND, "DISPUTE_NOT_FOUND");
  if (existing.status !== DisputeStatus.open) {
    throw new AppError(httpStatus.BAD_REQUEST, "DISPUTE_ALREADY_HANDLED", { status: existing.status });
  }

  const withRefund = payload.status === DisputeStatus.resolved && payload.issueRefund;
  const refundAmount = payload.refundAmount ?? existing.amount;
  if (withRefund && !refundAmount) {
    throw new AppError(httpStatus.BAD_REQUEST, "REFUND_AMOUNT_REQUIRED");
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
    throw new AppError(httpStatus.CONFLICT, "DISPUTE_CONFLICT");
  }

  if (withRefund) {
    try {
      await issueRefund(adminUserId, {
        orderId: String(dispute.orderId),
        subOrderId: dispute.subOrderId ? String(dispute.subOrderId) : undefined,
        amount: refundAmount as number,
        reason: `Dispute resolved: ${payload.adminResolution}`,
        note: payload.adminResolution,
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
    throw new AppError(httpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND");
  }
  const payment = await Payment.findOne({ _id: paymentId, payerId }).select("-raw");
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND");
  if (payment.status === PaymentStatus.pending && (await syncFromGateway(payment))) {
    return (await Payment.findById(payment._id).select("-raw")) ?? payment;
  }
  return payment;
};

// A webhook can get lost: while the app polls a pending payment, ask the aggregator (at most every 15 s)
const STATUS_CHECK_MS = 15_000;
const lastStatusCheck = new Map<string, number>();
const syncFromGateway = async (payment: { _id: unknown; providerRef?: string; provider?: string }) => {
  if (isDemoPayments()) return false;
  const id = String(payment._id);
  const last = lastStatusCheck.get(id) ?? 0;
  if (Date.now() - last < STATUS_CHECK_MS) return false;
  lastStatusCheck.set(id, Date.now());
  if (lastStatusCheck.size > 5000) lastStatusCheck.clear();
  let gateway;
  try {
    gateway = paymentGateway();
  } catch {
    return false;
  }
  if (!gateway.fetchStatus || gateway.name !== payment.provider) return false;
  const event = await gateway.fetchStatus({ paymentId: id, providerRef: payment.providerRef }).catch(() => null);
  if (!event || event.status === "pending") return false;
  await handleWebhook({ paymentId: id, status: event.status, amount: event.amount, raw: event.raw }).catch(() => undefined);
  return true;
};

/** POST /payments/webhook/:provider — the aggregator's own notification, signature checked by its gateway */
const handleGatewayWebhook = async (provider: string, request: WebhookRequest) => {
  const gateway = gatewayForWebhook(provider);
  if (!gateway) throw new AppError(httpStatus.NOT_FOUND, "ROUTE_NOT_FOUND");
  const event = await gateway.parseWebhook(request);
  if (!event || event.status === "pending") return { received: true };
  // Look the payment up by the aggregator's id, and only one of ours
  const payment = event.providerRef
    ? await Payment.findOne({ providerRef: event.providerRef, provider: gateway.name }).select("_id")
    : event.paymentId && Types.ObjectId.isValid(event.paymentId)
      ? await Payment.findOne({ _id: event.paymentId, provider: gateway.name }).select("_id")
      : null;
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND");
  await handleWebhook({ paymentId: String(payment._id), status: event.status, amount: event.amount, raw: event.raw });
  return { received: true };
};

/**
 * Demo payments: no gateway is connected yet, so the app can finish its own
 * pending payment the way the gateway webhook would. Allowed in development,
 * and in production while PAYMENT_MODE=demo.
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
  /** "true": open requests past their 7-day due date */
  overdue?: string;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.overdue === "true") Object.assign(filter, { status: RefundStatus.pending, dueBy: { $lt: new Date() } });
  // Open requests: the most urgent (due first) on top
  const open = filter.status === RefundStatus.pending;

  const [refunds, total] = await Promise.all([
    Refund.find(filter)
      .populate("customerId", "name phone email")
      .populate("orderId", "orderNumber total paymentMethod paymentStatus status")
      .populate("lines.subOrderId", "subOrderNumber")
      .populate("issuedBy", "name")
      .sort(open ? { dueBy: 1, createdAt: 1 } : { createdAt: -1 })
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
  handleGatewayWebhook,
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

import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { PaymentMethod, PaymentPurpose, PaymentStatus } from "../payment/payment.interface";
import { PaymentServices } from "../payment/payment.service";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import {
  ISubscriptionPlan,
  PlanAudience,
  PlanFeature,
  SubscriptionStatus,
} from "./subscription.interface";
import { SubscriptionPlan } from "./subscription_plan.model";
import { UserSubscription } from "./user_subscription.model";
import { extendWorkerListing } from "../professional_profile/worker_listing";

const createPlan = async (
  adminUserId: string,
  payload: Omit<ISubscriptionPlan, "_id" | "createdAt" | "updatedAt">,
) => {
  const plan = await SubscriptionPlan.create({
    ...payload,
    createdBy: new Types.ObjectId(adminUserId),
  });
  return plan;
};

const updatePlan = async (
  planId: string,
  payload: Partial<ISubscriptionPlan>,
) => {
  const plan = await SubscriptionPlan.findByIdAndUpdate(planId, payload, {
    new: true,
  });
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, "Subscription plan not found");
  return plan;
};

const getActivePlans = async (audience?: PlanAudience) => {
  const filter: Record<string, unknown> = { isActive: true };
  if (audience) filter.audience = audience;

  return SubscriptionPlan.find(filter).sort({ price: 1 });
};

/** Admin: every plan (active or not) with how many people are on it right now. */
const getAllPlansForAdmin = async () => {
  const [plans, counts] = await Promise.all([
    SubscriptionPlan.find().sort({ audience: 1, price: 1 }).lean(),
    UserSubscription.aggregate<{ _id: Types.ObjectId; active: number }>([
      { $match: { status: SubscriptionStatus.active, endsAt: { $gt: new Date() } } },
      { $group: { _id: "$planId", active: { $sum: 1 } } },
    ]),
  ]);
  const activeByPlan = new Map(counts.map((c) => [String(c._id), c.active]));
  return plans.map((plan) => ({ ...plan, activeSubscribers: activeByPlan.get(String(plan._id)) ?? 0 }));
};

const subscribe = async (
  userId: string,
  payload: { planId: string; paymentMethod: PaymentMethod },
) => {
  const plan = await SubscriptionPlan.findById(payload.planId);
  if (!plan || !plan.isActive) {
    throw new AppError(httpStatus.NOT_FOUND, "Active subscription plan not found");
  }

  // 1. Process subscription payment
  const payment = await PaymentServices.initiatePayment(userId, {
    purpose: PaymentPurpose.subscription,
    refId: String(plan._id),
    method: payload.paymentMethod,
  });

  const startsAt = new Date();
  const endsAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);

  const isPaid = payment.status === PaymentStatus.success;

  // 2. Create user subscription (starts pending until gateway confirms payment)
  const subscription = await UserSubscription.create({
    userId: new Types.ObjectId(userId),
    planId: plan._id,
    planSnapshot: {
      name: plan.name,
      price: plan.price,
      features: plan.features,
    },
    status: isPaid ? SubscriptionStatus.active : SubscriptionStatus.pending,
    startsAt,
    endsAt,
    paymentId: payment._id,
  });

  // 3. If payment confirmed and plan includes CV visibility, unlock on professional profile
  if (isPaid && plan.features.includes(PlanFeature.cv_visibility)) {
    await ProfessionalProfile.findOneAndUpdate(
      { userId },
      { $set: { cvVisible: true, visibleUntil: endsAt } },
      { upsert: true },
    );
  }
  // A service-provider plan keeps the worker visible to customers
  if (isPaid && plan.audience === PlanAudience.service_provider) {
    await extendWorkerListing(userId, plan.durationDays);
  }

  return { subscription, payment };
};

const getMySubscription = async (userId: string) => {
  const subscription = await UserSubscription.findOne({
    userId,
    status: SubscriptionStatus.active,
    endsAt: { $gt: new Date() },
  })
    .populate("planId", "name audience durationDays features")
    .sort({ endsAt: -1 });

  return subscription;
};

export const SubscriptionServices = {
  getAllPlansForAdmin,
  createPlan,
  updatePlan,
  getActivePlans,
  subscribe,
  getMySubscription,
};

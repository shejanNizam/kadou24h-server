import { Document, Types } from "mongoose";

export enum PlanAudience {
  job_seeker = "job_seeker",
  service_provider = "service_provider",
}

export enum SubscriptionStatus {
  pending = "pending",
  active = "active",
  expired = "expired",
  cancelled = "cancelled",
}

export interface ISubscriptionPlanInitial {
  name: string;
  audience: PlanAudience;
  price: number;
  durationDays: number;
  features: string[];
  isActive: boolean;
  createdBy?: Types.ObjectId;
}

export type ISubscriptionPlan = ISubscriptionPlanInitial & Document;

export interface IPlanSnapshot {
  name: string;
  price: number;
  features: string[];
}

export interface IUserSubscriptionInitial {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  planSnapshot: IPlanSnapshot;
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date;
  paymentId?: Types.ObjectId;
}

export type IUserSubscription = IUserSubscriptionInitial & Document;

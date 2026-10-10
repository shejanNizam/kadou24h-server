import { model, Schema } from "mongoose";
import {
  ISubscriptionPlan,
  PlanAudience,
  PlanFeature,
} from "./subscription.interface";

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    name: { type: String, required: true, trim: true },
    audience: {
      type: String,
      enum: Object.values(PlanAudience),
      required: true,
    },
    price: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1, default: 30 },
    features: { type: [String], enum: Object.values(PlanFeature), default: [] },
    highlights: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const SubscriptionPlan = model<ISubscriptionPlan>(
  "SubscriptionPlan",
  subscriptionPlanSchema,
);

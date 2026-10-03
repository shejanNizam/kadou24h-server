import { model, Schema } from "mongoose";
import {
  IUserSubscription,
  SubscriptionStatus,
} from "./subscription.interface";

const planSnapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    features: { type: [String], default: [] },
  },
  { _id: false },
);

const userSubscriptionSchema = new Schema<IUserSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
    },
    planSnapshot: { type: planSnapshotSchema, required: true },
    status: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.active,
      required: true,
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSubscriptionSchema.index({ userId: 1, status: 1 });
userSubscriptionSchema.index({ endsAt: 1 });

export const UserSubscription = model<IUserSubscription>(
  "UserSubscription",
  userSubscriptionSchema,
);

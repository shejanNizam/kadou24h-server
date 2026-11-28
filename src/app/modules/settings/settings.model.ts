import { model, Schema } from "mongoose";
import { ISettings, PayoutMethodType } from "./settings.interface";

const withdrawalFeeSchema = new Schema(
  {
    method: { type: String, enum: Object.values(PayoutMethodType), required: true },
    type: { type: String, enum: ["fixed", "percent"], required: true },
    value: { type: Number, required: true },
  },
  { _id: false },
);

// Singleton collection — exactly one document, created on first read.
const settingsSchema = new Schema<ISettings>(
  {
    platformName: { type: String, default: "Kadou" },
    supportEmail: { type: String },
    contactNumber: { type: String },
    whatsappSupportNumber: { type: String },
    defaultCurrency: { type: String, default: "GNF" },
    logo: {
      url: { type: String },
      publicId: { type: String },
    },

    commission: {
      rate: { type: Number, default: 10 },
      min: { type: Number, default: 1000 },
    },
    platformFee: { type: Number, default: 1000 },
    taxRate: { type: Number, default: 0 },
    withdrawalFees: {
      type: [withdrawalFeeSchema],
      default: [
        { method: PayoutMethodType.orange_money, type: "fixed", value: 500 },
        { method: PayoutMethodType.mobile_money, type: "fixed", value: 500 },
        { method: PayoutMethodType.bank, type: "fixed", value: 1000 },
      ],
    },
    riderCashLimitDefault: { type: Number, default: 1_000_000 },
    escrowReleaseHours: { type: Number, default: 0 },

    pricing: {
      jobPublishFee: { type: Number, default: 5000 },
      cvUnlockFee: { type: Number, default: 5000 },
      spontaneousApplicationFee: { type: Number, default: 5000 },
    },

    orders: {
      acceptMinutes: { type: Number, default: 480, min: 5, max: 1440 },
    },

    intercity: {
      firstMileFee: { type: Number, default: 10000, min: 0 },
      lastMileFee: { type: Number, default: 10000, min: 0 },
      maxAddressKm: { type: Number, default: 30, min: 5, max: 200 },
    },

    rides: {
      enabled: { type: Boolean, default: true },
      baseFare: { type: Number, default: 3000 },
      perKm: { type: Number, default: 1500 },
      minFare: { type: Number, default: 5000 },
      maxRaisePercent: { type: Number, default: 30, min: 0, max: 100 },
      searchRadiusKm: { type: Number, default: 5, min: 1, max: 20 },
      subscriptionRequired: { type: Boolean, default: false },
      trialDays: { type: Number, default: 30, min: 0 },
    },

    chat: {
      retentionDays: { type: Number, default: 90, min: 30, max: 730 },
    },

    assistant: {
      enabled: { type: Boolean, default: true },
      dailyLimitPerUser: { type: Number, default: 20, min: 1, max: 200 },
      dailyLimitTotal: { type: Number, default: 2000, min: 10, max: 100000 },
      knowledge: { type: String, default: "", maxlength: 8000 },
    },

    moderation: {
      restrictAfter: { type: Number, default: 3 },
      suspendAfter: { type: Number, default: 5 },
      restrictHours: { type: Number, default: 24 },
    },

    emailToggles: {
      orderConfirmation: { type: Boolean, default: true },
      paymentVerification: { type: Boolean, default: true },
      invoice: { type: Boolean, default: true },
      disputeUpdates: { type: Boolean, default: true },
    },

    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Settings = model<ISettings>("Settings", settingsSchema);

import z from "zod";
import { PayoutMethodType } from "./settings.interface";

const gnf = (field: string) =>
  z
    .number({ error: `${field} must be a number` })
    .int({ message: `${field} must be a whole GNF amount` })
    .min(0, { message: `${field} cannot be negative` });

const percent = (field: string) =>
  z
    .number({ error: `${field} must be a number` })
    .min(0, { message: `${field} cannot be negative` })
    .max(100, { message: `${field} cannot exceed 100` });

export const updateSettingsZodSchema = z
  .object({
    platformName: z.string().min(1).max(60),
    supportEmail: z.string().email({ message: "Invalid support email" }),
    contactNumber: z.string().max(30),
    whatsappSupportNumber: z.string().max(30),
    defaultCurrency: z.string().length(3, { message: "Currency must be a 3-letter code" }),
    logo: z.object({ url: z.string().url(), publicId: z.string() }),

    commission: z.object({ rate: percent("commission.rate"), min: gnf("commission.min") }).partial(),
    platformFee: gnf("platformFee"),
    taxRate: percent("taxRate"),
    withdrawalFees: z.array(
      z.object({
        method: z.enum(Object.values(PayoutMethodType) as [string, ...string[]]),
        type: z.enum(["fixed", "percent"]),
        value: z.number().min(0),
      }),
    ),
    riderCashLimitDefault: gnf("riderCashLimitDefault"),
    escrowReleaseHours: z.number().int().min(0).max(24 * 30),

    pricing: z
      .object({
        jobPublishFee: gnf("pricing.jobPublishFee"),
        cvUnlockFee: gnf("pricing.cvUnlockFee"),
        spontaneousApplicationFee: gnf("pricing.spontaneousApplicationFee"),
      })
      .partial(),

    rides: z
      .object({
        enabled: z.boolean(),
        baseFare: gnf("rides.baseFare"),
        perKm: gnf("rides.perKm"),
        minFare: gnf("rides.minFare"),
        subscriptionRequired: z.boolean(),
        trialDays: z.number().int().min(0).max(365),
      })
      .partial(),

    moderation: z
      .object({
        restrictAfter: z.number().int().min(1),
        suspendAfter: z.number().int().min(1),
        restrictHours: z.number().int().min(1),
      })
      .partial(),

    emailToggles: z
      .object({
        orderConfirmation: z.boolean(),
        paymentVerification: z.boolean(),
        invoice: z.boolean(),
        disputeUpdates: z.boolean(),
      })
      .partial(),
  })
  .partial()
  .strict();

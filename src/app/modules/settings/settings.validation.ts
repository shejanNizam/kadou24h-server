import z from "zod";
import { PayoutMethodType } from "./settings.interface";

// The field name is the error's path, so the messages need not repeat it
const gnf = () => z.number().int({ message: "WHOLE_NUMBER" }).min(0, { message: "NUMBER_TOO_LOW" });

const percent = () => z.number().min(0, { message: "NUMBER_TOO_LOW" }).max(100, { message: "NUMBER_TOO_HIGH" });

export const updateSettingsZodSchema = z
  .object({
    platformName: z.string().min(1).max(60),
    supportEmail: z.string().email({ message: "EMAIL_INVALID" }),
    contactNumber: z.string().max(30),
    whatsappSupportNumber: z.string().max(30),
    defaultCurrency: z.string().length(3, { message: "CURRENCY_CODE_INVALID" }),
    logo: z.object({ url: z.string().url(), publicId: z.string() }),

    commission: z.object({ rate: percent(), min: gnf() }).partial(),
    platformFee: gnf(),
    taxRate: percent(),
    withdrawalFees: z.array(
      z.object({
        method: z.enum(Object.values(PayoutMethodType) as [string, ...string[]]),
        type: z.enum(["fixed", "percent"]),
        value: z.number().min(0),
      }),
    ),
    riderCashLimitDefault: gnf(),
    escrowReleaseHours: z.number().int().min(0).max(24 * 30),

    pricing: z
      .object({
        jobPublishFee: gnf(),
        cvUnlockFee: gnf(),
        spontaneousApplicationFee: gnf(),
      })
      .partial(),

    orders: z
      .object({
        acceptMinutes: z.number().int().min(5, { message: "NUMBER_TOO_LOW" }).max(1440, { message: "NUMBER_TOO_HIGH" }),
      })
      .partial(),

    intercity: z
      .object({
        firstMileFee: gnf(),
        lastMileFee: gnf(),
        maxAddressKm: z.number().int({ message: "WHOLE_NUMBER" }).min(5, { message: "NUMBER_TOO_LOW" }).max(200, { message: "NUMBER_TOO_HIGH" }),
      })
      .partial(),

    rides: z
      .object({
        enabled: z.boolean(),
        baseFare: gnf(),
        perKm: gnf(),
        minFare: gnf(),
        maxRaisePercent: z.number().int().min(0, { message: "NUMBER_TOO_LOW" }).max(100, { message: "NUMBER_TOO_HIGH" }),
        searchRadiusKm: z.number().min(1, { message: "NUMBER_TOO_LOW" }).max(20, { message: "NUMBER_TOO_HIGH" }),
        subscriptionRequired: z.boolean(),
        trialDays: z.number().int().min(0).max(365),
      })
      .partial(),

    chat: z
      .object({
        retentionDays: z.number().int().min(30, { message: "NUMBER_TOO_LOW" }).max(730, { message: "NUMBER_TOO_HIGH" }),
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

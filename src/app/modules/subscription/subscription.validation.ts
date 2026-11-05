import z from "zod";
import { PlanAudience, PlanFeature } from "./subscription.interface";
import { PaymentMethod } from "../payment/payment.interface";

// Shared fields WITHOUT defaults: a .partial() of a schema with defaults would
// fill them in on every PATCH and silently overwrite stored values
const planFields = {
  name: z.string().trim().min(2).max(100),
  audience: z.enum(Object.values(PlanAudience) as [string, ...string[]]),
  price: z.number().int().min(0),
  durationDays: z.number().int().min(1),
  features: z.array(z.enum(Object.values(PlanFeature) as [string, ...string[]])),
  highlights: z.array(z.string().trim().min(1).max(120)).max(10),
};

export const createPlanSchema = z.object({
  ...planFields,
  durationDays: planFields.durationDays.default(30),
  features: planFields.features.default([]),
  highlights: planFields.highlights.default([]),
});

export const updatePlanSchema = z.object({ ...planFields, isActive: z.boolean() }).partial();

export const subscribeSchema = z.object({
  planId: z.string().regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID"),
  paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
});

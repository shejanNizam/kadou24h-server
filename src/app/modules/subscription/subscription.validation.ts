import z from "zod";
import { PlanAudience } from "./subscription.interface";
import { PaymentMethod } from "../payment/payment.interface";

export const createPlanSchema = z.object({
  name: z.string().trim().min(2).max(100),
  audience: z.enum(Object.values(PlanAudience) as [string, ...string[]]),
  price: z.number().int().min(0),
  durationDays: z.number().int().min(1).default(30),
  features: z.array(z.string().trim().min(1)).default([]),
});

export const updatePlanSchema = createPlanSchema.partial();

export const subscribeSchema = z.object({
  planId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Valid planId required"),
  paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
});

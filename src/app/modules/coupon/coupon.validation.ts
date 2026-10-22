import z from "zod";
import { CouponType } from "./coupon.interface";

const code = z
  .string()
  .trim()
  .min(3, "At least 3 characters")
  .max(20, "At most 20 characters")
  .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only");

export const createCouponZodSchema = z.object({
  code,
  description: z.string().trim().max(200).optional(),
  type: z.enum(CouponType),
  value: z.number().int().min(1),
  maxDiscount: z.number().int().min(1).optional(),
  minOrder: z.number().int().min(0).default(0),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date({ error: "Choose an end date" }),
  usageLimit: z.number().int().min(1).optional(),
  isActive: z.boolean().default(true),
});

export const updateCouponZodSchema = z.object({
  code: code.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  type: z.enum(CouponType).optional(),
  value: z.number().int().min(1).optional(),
  maxDiscount: z.number().int().min(1).nullable().optional(),
  minOrder: z.number().int().min(0).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

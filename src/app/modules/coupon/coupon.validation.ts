import z from "zod";
import { CouponType } from "./coupon.interface";

const code = z
  .string()
  .trim()
  .min(3, "TEXT_TOO_SHORT")
  .max(20, "TEXT_TOO_LONG")
  .regex(/^[A-Za-z0-9_-]+$/, "COUPON_CODE_FORMAT");

export const createCouponZodSchema = z.object({
  code,
  description: z.string().trim().max(200).optional(),
  type: z.enum(CouponType),
  value: z.number().int().min(1),
  maxDiscount: z.number().int().min(1).optional(),
  minOrder: z.number().int().min(0).default(0),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date({ error: "END_DATE_REQUIRED" }),
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

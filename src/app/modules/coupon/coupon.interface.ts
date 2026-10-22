import { Document, Types } from "mongoose";

/**
 * Promo codes (client, 2026-10-22): created only by the Kadou24h team, the discount
 * is paid by Kadou24h (stores still earn their full share), with an expiry date, a
 * minimum order and one use per customer.
 */
export enum CouponType {
  percent = "percent",
  fixed = "fixed",
}

export interface ICouponInitial {
  /** Upper-case, e.g. "KADOU10" */
  code: string;
  description?: string;
  type: CouponType;
  /** percent: 1–100; fixed: GNF */
  value: number;
  /** percent only: the most a customer can save (GNF) */
  maxDiscount?: number;
  /** Products subtotal needed (GNF) */
  minOrder: number;
  startsAt?: Date;
  expiresAt: Date;
  /** Total uses allowed (all customers); empty = no limit */
  usageLimit?: number;
  usedCount: number;
  /** Total discount given so far (GNF) — Kadou24h's cost */
  discountGiven: number;
  isActive: boolean;
  createdBy?: Types.ObjectId;
}

export type ICoupon = ICouponInitial & Document & { createdAt: Date; updatedAt: Date };

export enum RedemptionStatus {
  /** Counts as the customer's one use */
  active = "active",
  /** The whole order was cancelled: the customer can use the code again */
  released = "released",
}

export interface ICouponRedemptionInitial {
  couponId: Types.ObjectId;
  code: string;
  customerId: Types.ObjectId;
  orderId: Types.ObjectId;
  orderNumber: string;
  amount: number;
  status: RedemptionStatus;
  releasedAt?: Date;
}

export type ICouponRedemption = ICouponRedemptionInitial & Document & { createdAt: Date };

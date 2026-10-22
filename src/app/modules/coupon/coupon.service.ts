/**
 * Promo codes (client, 2026-10-22). Only the Kadou24h team creates them; Kadou24h pays
 * the discount (stores keep their full earning); expiry, minimum order, one use per
 * customer. A fully cancelled order gives the code back.
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { escapeRegex } from "../../utils/queryParams";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { CouponType, ICoupon, RedemptionStatus } from "./coupon.interface";
import { Coupon, CouponRedemption } from "./coupon.model";

const gnf = (n: number) => `${n.toLocaleString("fr-FR")} GNF`;

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

/** What this code takes off a products subtotal */
const discountFor = (coupon: Pick<ICoupon, "type" | "value" | "maxDiscount">, subtotal: number) => {
  const raw = coupon.type === CouponType.percent ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
  const capped = coupon.type === CouponType.percent && coupon.maxDiscount ? Math.min(raw, coupon.maxDiscount) : raw;
  // Never more than the products themselves (delivery and service fee are always paid)
  return Math.max(0, Math.min(capped, subtotal));
};

/**
 * Checks a code for this customer and products subtotal. Throws a clear 400 when it
 * can't be used (checkout-summary turns it into a message, placing the order refuses it).
 */
const evaluate = async (rawCode: string, customerId: string, subtotal: number) => {
  const code = normalizeCode(rawCode);
  const now = new Date();
  const coupon = await Coupon.findOne({ code });
  if (!coupon || !coupon.isActive) throw new AppError(httpStatus.BAD_REQUEST, "This promo code is not valid");
  if (coupon.startsAt && coupon.startsAt > now) throw new AppError(httpStatus.BAD_REQUEST, "This promo code is not valid yet");
  if (coupon.expiresAt <= now) throw new AppError(httpStatus.BAD_REQUEST, "This promo code has expired");
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    throw new AppError(httpStatus.BAD_REQUEST, "This promo code has been fully used");
  }
  const used = await CouponRedemption.exists({ couponId: coupon._id, customerId, status: RedemptionStatus.active });
  if (used) throw new AppError(httpStatus.BAD_REQUEST, "You have already used this promo code");
  if (subtotal < coupon.minOrder) {
    throw new AppError(httpStatus.BAD_REQUEST, `This promo code needs a minimum order of ${gnf(coupon.minOrder)}`);
  }
  return { coupon, discount: discountFor(coupon, subtotal) };
};

/**
 * Uses the code for a placed order: one atomic +1 (respecting the total limit) and the
 * customer's single redemption. Returns what to undo if the checkout fails afterwards.
 */
const redeem = async (
  coupon: Pick<ICoupon, "_id" | "code">,
  params: { customerId: string; orderId: Types.ObjectId; orderNumber: string; amount: number },
) => {
  const counted = await Coupon.findOneAndUpdate(
    {
      _id: coupon._id,
      isActive: true,
      expiresAt: { $gt: new Date() },
      $or: [{ usageLimit: { $exists: false } }, { usageLimit: null }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }],
    },
    { $inc: { usedCount: 1, discountGiven: params.amount } },
  );
  if (!counted) throw new AppError(httpStatus.CONFLICT, "This promo code has just been fully used");
  try {
    const redemption = await CouponRedemption.create({
      couponId: coupon._id,
      code: coupon.code,
      customerId: new Types.ObjectId(params.customerId),
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      amount: params.amount,
    });
    return { couponId: coupon._id as Types.ObjectId, redemptionId: redemption._id as Types.ObjectId, amount: params.amount };
  } catch (error) {
    await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: -1, discountGiven: -params.amount } });
    if ((error as { code?: number }).code === 11000) throw new AppError(httpStatus.BAD_REQUEST, "You have already used this promo code");
    throw error;
  }
};

/** Checkout rollback */
const undoRedemption = async (done: { couponId: Types.ObjectId; redemptionId: Types.ObjectId; amount: number }) => {
  await CouponRedemption.deleteOne({ _id: done.redemptionId });
  await Coupon.updateOne({ _id: done.couponId }, { $inc: { usedCount: -1, discountGiven: -done.amount } });
};

/** The whole order was cancelled (customer, store, admin or the payment window): the code is free again. Idempotent. */
const releaseForOrder = async (orderId: Types.ObjectId | string) => {
  const redemption = await CouponRedemption.findOneAndUpdate(
    { orderId, status: RedemptionStatus.active },
    { $set: { status: RedemptionStatus.released, releasedAt: new Date() } },
  );
  if (redemption) {
    await Coupon.updateOne({ _id: redemption.couponId }, { $inc: { usedCount: -1, discountGiven: -redemption.amount } });
  }
  return Boolean(redemption);
};

// ── Admin ───────────────────────────────────────────────────────────

type CouponInput = Partial<Omit<ICoupon, "code">> & { code?: string };

const validateShape = (c: CouponInput) => {
  if (c.type === CouponType.percent && c.value !== undefined && c.value > 100) {
    throw new AppError(httpStatus.BAD_REQUEST, "A percentage can't be more than 100");
  }
  if (c.startsAt && c.expiresAt && new Date(c.startsAt) >= new Date(c.expiresAt)) {
    throw new AppError(httpStatus.BAD_REQUEST, "The end date must be after the start date");
  }
};

const createCoupon = async (payload: CouponInput & { code: string }, actorId: string) => {
  validateShape(payload);
  const code = normalizeCode(payload.code);
  if (await Coupon.exists({ code })) throw new AppError(httpStatus.CONFLICT, "This code already exists");
  const coupon = await Coupon.create({ ...payload, code, createdBy: new Types.ObjectId(actorId) });
  await AuditLogServices.record({ actorId, action: "coupon.create", targetType: "coupon", targetId: String(coupon._id), after: { code, type: coupon.type, value: coupon.value } });
  return coupon;
};

/** Once used, the code, type and value are locked (customers already got that deal). */
const updateCoupon = async (id: string, payload: CouponInput, actorId: string) => {
  const coupon = Types.ObjectId.isValid(id) ? await Coupon.findById(id) : null;
  if (!coupon) throw new AppError(httpStatus.NOT_FOUND, "Promo code not found");
  const locked = coupon.usedCount > 0;
  if (locked && (payload.code !== undefined || payload.type !== undefined || payload.value !== undefined)) {
    const changed =
      (payload.code !== undefined && normalizeCode(payload.code) !== coupon.code) ||
      (payload.type !== undefined && payload.type !== coupon.type) ||
      (payload.value !== undefined && payload.value !== coupon.value);
    if (changed) throw new AppError(httpStatus.BAD_REQUEST, "This code was already used: its code, type and value can't change. Create a new code instead.");
  }
  validateShape({ ...coupon.toObject(), ...payload });
  if (payload.code !== undefined) {
    const code = normalizeCode(payload.code);
    if (code !== coupon.code && (await Coupon.exists({ code }))) throw new AppError(httpStatus.CONFLICT, "This code already exists");
    payload.code = code;
  }
  const before = { isActive: coupon.isActive, expiresAt: coupon.expiresAt, usageLimit: coupon.usageLimit };
  // null clears optional limits
  for (const key of ["maxDiscount", "usageLimit", "startsAt", "description"] as const) {
    if ((payload as Record<string, unknown>)[key] === null) {
      coupon.set(key, undefined);
      Reflect.deleteProperty(payload, key);
    }
  }
  coupon.set(payload);
  await coupon.save();
  await AuditLogServices.record({ actorId, action: "coupon.update", targetType: "coupon", targetId: id, before, after: payload });
  return coupon;
};

const status = (c: Pick<ICoupon, "isActive" | "startsAt" | "expiresAt" | "usageLimit" | "usedCount">, now = new Date()) =>
  !c.isActive
    ? "inactive"
    : c.expiresAt <= now
      ? "expired"
      : c.usageLimit && c.usedCount >= c.usageLimit
        ? "used_up"
        : c.startsAt && c.startsAt > now
          ? "scheduled"
          : "active";

const listCoupons = async (query: { status?: string; search?: string; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const now = new Date();
  const filter: Record<string, unknown> = {};
  if (query.search?.trim()) filter.code = { $regex: escapeRegex(normalizeCode(query.search)), $options: "i" };
  if (query.status === "active") Object.assign(filter, { isActive: true, expiresAt: { $gt: now } });
  else if (query.status === "expired") Object.assign(filter, { expiresAt: { $lte: now } });
  else if (query.status === "inactive") Object.assign(filter, { isActive: false });
  const [rows, total, totals] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Coupon.countDocuments(filter),
    Coupon.aggregate<{ used: number; given: number; active: number }>([
      {
        $group: {
          _id: null,
          used: { $sum: "$usedCount" },
          given: { $sum: "$discountGiven" },
          active: { $sum: { $cond: [{ $and: ["$isActive", { $gt: ["$expiresAt", now] }] }, 1, 0] } },
        },
      },
    ]),
  ]);
  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
      summary: { activeCodes: totals[0]?.active ?? 0, uses: totals[0]?.used ?? 0, discountGiven: totals[0]?.given ?? 0 },
    },
    data: rows.map((c) => ({ ...c, status: status(c, now) })),
  };
};

const getCoupon = async (id: string) => {
  const coupon = Types.ObjectId.isValid(id) ? await Coupon.findById(id).lean() : null;
  if (!coupon) throw new AppError(httpStatus.NOT_FOUND, "Promo code not found");
  const redemptions = await CouponRedemption.find({ couponId: coupon._id })
    .populate("customerId", "name phone")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return { ...coupon, status: status(coupon), redemptions };
};

export const CouponServices = {
  evaluate,
  discountFor,
  redeem,
  undoRedemption,
  releaseForOrder,
  createCoupon,
  updateCoupon,
  listCoupons,
  getCoupon,
};

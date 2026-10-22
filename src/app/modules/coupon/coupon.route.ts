import { Router } from "express";
import httpStatus from "http-status";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ADMIN_ROLES, UserRole } from "../user/user.interface";
import { CouponServices } from "./coupon.service";
import { createCouponZodSchema, updateCouponZodSchema } from "./coupon.validation";

const router = Router();
const staff = checkAuth(...ADMIN_ROLES);
const admin = checkAuth(UserRole.admin, UserRole.super_admin);

/**
 * @swagger
 * /coupons/admin:
 *   get:
 *     tags: [Coupons]
 *     summary: Admin — promo codes (status=active|expired|inactive, search); meta.summary = active codes, uses, discount given
 *     security: [{ bearerAuth: [] }]
 *   post:
 *     tags: [Coupons]
 *     summary: Admin — create a promo code { code, type percent|fixed, value, maxDiscount?, minOrder, startsAt?, expiresAt, usageLimit?, description? }
 *     description: Kadou24h pays the discount (stores keep their full earning). One use per customer.
 *     security: [{ bearerAuth: [] }]
 * /coupons/admin/{id}:
 *   get:
 *     tags: [Coupons]
 *     summary: Admin — one promo code with its uses (customer, order, amount)
 *     security: [{ bearerAuth: [] }]
 *   patch:
 *     tags: [Coupons]
 *     summary: Admin — edit / pause a promo code (code, type and value are locked once used; null clears a limit)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/admin",
  staff,
  catchAsync(async (req, res) => {
    const result = await CouponServices.listCoupons(req.query as never);
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Promo codes retrieved", meta: result.meta, data: result.data });
  }),
);
router.post(
  "/admin",
  admin,
  validateRequest(createCouponZodSchema),
  catchAsync(async (req, res) => {
    sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: "Promo code created", data: await CouponServices.createCoupon(req.body, req.user._id) });
  }),
);
router.get(
  "/admin/:id",
  staff,
  catchAsync(async (req, res) => {
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Promo code retrieved", data: await CouponServices.getCoupon(String(req.params.id)) });
  }),
);
router.patch(
  "/admin/:id",
  admin,
  validateRequest(updateCouponZodSchema),
  catchAsync(async (req, res) => {
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Promo code updated", data: await CouponServices.updateCoupon(String(req.params.id), req.body, req.user._id) });
  }),
);

export const CouponRoutes = router;

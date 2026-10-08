import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, APP_ROLES } from "../user/user.interface";
import { PaymentControllers } from "./payment.controller";
import {
  createDisputeSchema,
  initiatePaymentSchema,
  issueRefundSchema,
  resolveDisputeSchema,
  webhookSchema,
} from "./payment.validation";

const router = Router();

// Customer / App Payment endpoints

/**
 * @swagger
 * /payments/initiate:
 *   post:
 *     tags: [Wallet]
 *     summary: Initiate order payment (Orange Money, Card, Mobile Money)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, paymentMethod]
 *             properties:
 *               orderId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *               paymentMethod: { type: string, enum: [orange_money, mobile_money, card, stripe] }
 *     responses:
 *       200:
 *         description: Payment intent or checkout session created
 */
router.post(
  "/initiate",
  checkAuth(...APP_ROLES),
  validateRequest(initiatePaymentSchema),
  PaymentControllers.initiatePayment,
);

router.post(
  "/webhook",
  validateRequest(webhookSchema),
  PaymentControllers.handleWebhook,
);

router.get("/me", checkAuth(...APP_ROLES), PaymentControllers.getMyPayments);

// Customer Disputes
router.post(
  "/disputes",
  checkAuth(...APP_ROLES),
  validateRequest(createDisputeSchema),
  PaymentControllers.createDispute,
);

router.get(
  "/disputes",
  checkAuth(...APP_ROLES),
  PaymentControllers.getMyDisputes,
);

// ── Admin Routes ──
router.get(
  "/admin/all",
  checkAuth(...ADMIN_ROLES),
  PaymentControllers.getAllPaymentsAdmin,
);

router.post(
  "/admin/refunds",
  checkAuth(...ADMIN_ROLES),
  validateRequest(issueRefundSchema),
  PaymentControllers.issueRefund,
);

router.get(
  "/admin/refunds",
  checkAuth(...ADMIN_ROLES),
  PaymentControllers.getAllRefundsAdmin,
);

router.get(
  "/admin/disputes",
  checkAuth(...ADMIN_ROLES),
  PaymentControllers.getAllDisputesAdmin,
);

router.patch(
  "/admin/disputes/:id/resolve",
  checkAuth(...ADMIN_ROLES),
  validateRequest(resolveDisputeSchema),
  PaymentControllers.resolveDispute,
);

export const PaymentRoutes = router;

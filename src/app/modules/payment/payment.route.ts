import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, APP_ROLES } from "../user/user.interface";
import { PaymentControllers } from "./payment.controller";
import {
  createDisputeSchema,
  devConfirmSchema,
  initiatePaymentSchema,
  issueRefundSchema,
  processRefundSchema,
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

/**
 * @swagger
 * /payments/admin/refunds/{id}:
 *   patch:
 *     tags: [Wallet]
 *     summary: Approve (after sending the money) or reject a pending refund request
 *     description: Cancellations and store changes of online-paid orders open one pending request per order. Approving may use a lower amount.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [completed, rejected] }
 *               amount: { type: integer, description: "≤ requested; defaults to the requested amount" }
 *               transactionId: { type: string, description: "Orange Money / MoMo / bank reference" }
 *               rejectionReason: { type: string, description: "Required to reject; shown to the customer" }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Decided; the customer is notified
 *       409:
 *         description: Another admin just handled it
 */
router.patch(
  "/admin/refunds/:id",
  checkAuth(...ADMIN_ROLES),
  validateRequest(processRefundSchema),
  PaymentControllers.processRefund,
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

/**
 * @swagger
 * /payments/{id}:
 *   get:
 *     tags: [Wallet]
 *     summary: One of my payments (the app polls it while the payment is pending)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Payment with status pending | success | failed | refunded" }
 * /payments/{id}/dev-confirm:
 *   post:
 *     tags: [Wallet]
 *     summary: "Demo payment: finish my pending payment like the gateway webhook would (development, or PAYMENT_MODE=demo; else 404)"
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [success, failed] }
 */
router.get("/:id", checkAuth(...APP_ROLES), PaymentControllers.getMyPayment);
router.post(
  "/:id/dev-confirm",
  checkAuth(...APP_ROLES),
  validateRequest(devConfirmSchema),
  PaymentControllers.devConfirmPayment,
);

export const PaymentRoutes = router;

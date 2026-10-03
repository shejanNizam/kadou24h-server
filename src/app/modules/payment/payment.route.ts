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

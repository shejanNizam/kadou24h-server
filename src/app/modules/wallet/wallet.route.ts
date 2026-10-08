import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, APP_ROLES } from "../user/user.interface";
import { WalletControllers } from "./wallet.controller";
import {
  addPayoutMethodZodSchema,
  confirmCodSettlementSchema,
  processWithdrawalSchema,
  requestWithdrawalSchema,
  submitCodSettlementSchema,
  updatePayoutMethodZodSchema,
} from "./wallet.validation";

const router = Router();

// Applicants are still "customer" — the wallet itself proves an application exists.

/**
 * @swagger
 * /wallets/me:
 *   get:
 *     tags: [Wallet]
 *     summary: Get my wallet balance, payout methods & COD status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet details retrieved
 */
router.get("/me", checkAuth(...APP_ROLES), WalletControllers.getMyWallet);

// Payout Methods

/**
 * @swagger
 * /wallets/me/payout-methods:
 *   post:
 *     tags: [Wallet]
 *     summary: Add payout method (Orange Money, Mobile Money, Bank)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mode, type, accountName, accountNumber]
 *             properties:
 *               mode: { type: string, enum: [vendor, rider] }
 *               type: { type: string, enum: [orange_money, mobile_money, bank] }
 *               accountName: { type: string, example: "Mamadou Diallo" }
 *               accountNumber: { type: string, example: "+224620123456" }
 *               bankName: { type: string }
 *     responses:
 *       201:
 *         description: Payout method added
 */
router.post(
  "/me/payout-methods",
  checkAuth(...APP_ROLES),
  validateRequest(addPayoutMethodZodSchema),
  WalletControllers.addPayoutMethod,
);

router.patch(
  "/me/payout-methods/:methodId",
  checkAuth(...APP_ROLES),
  validateRequest(updatePayoutMethodZodSchema),
  WalletControllers.updatePayoutMethod,
);

router.delete(
  "/me/payout-methods/:methodId",
  checkAuth(...APP_ROLES),
  WalletControllers.deletePayoutMethod,
);

// Withdrawals & Ledger Transactions

/**
 * @swagger
 * /wallets/me/withdrawals:
 *   post:
 *     tags: [Wallet]
 *     summary: Request withdrawal from wallet (Vendor / Rider)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, payoutMethodId]
 *             properties:
 *               amount: { type: number, example: 500000 }
 *               payoutMethodId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *     responses:
 *       201:
 *         description: Withdrawal requested
 *   get:
 *     tags: [Wallet]
 *     summary: Get my withdrawal history (Vendor / Rider)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of withdrawals
 */
router.post(
  "/me/withdrawals",
  checkAuth(...APP_ROLES),
  validateRequest(requestWithdrawalSchema),
  WalletControllers.requestWithdrawal,
);

router.get(
  "/me/withdrawals",
  checkAuth(...APP_ROLES),
  WalletControllers.getMyWithdrawals,
);

/**
 * @swagger
 * /wallets/me/transactions:
 *   get:
 *     tags: [Wallet]
 *     summary: Get ledger transaction history (earnings, fees, payouts)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Transaction history
 */
router.get(
  "/me/transactions",
  checkAuth(...APP_ROLES),
  WalletControllers.getMyTransactions,
);

// COD Settlements

/**
 * @swagger
 * /wallets/me/cod-settlements:
 *   post:
 *     tags: [Wallet]
 *     summary: Submit cash-on-delivery collection deposit (Rider)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, paymentMethod]
 *             properties:
 *               amount: { type: number, example: 250000 }
 *               paymentMethod: { type: string, enum: [orange_money, mobile_money, bank] }
 *               transactionReference: { type: string, example: "TXN123456" }
 *     responses:
 *       201:
 *         description: COD settlement submitted
 */
router.post(
  "/me/cod-settlements",
  checkAuth(...APP_ROLES),
  validateRequest(submitCodSettlementSchema),
  WalletControllers.submitCodSettlement,
);

// ── Admin Routes ──

/**
 * @swagger
 * /wallets/admin/withdrawals:
 *   get:
 *     tags: [Wallet]
 *     summary: Get all withdrawal requests for admin review (Admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of withdrawal requests
 */
router.get(
  "/admin/withdrawals",
  checkAuth(...ADMIN_ROLES),
  WalletControllers.getAllWithdrawalsAdmin,
);

/**
 * @swagger
 * /wallets/admin/withdrawals/{id}:
 *   patch:
 *     tags: [Wallet]
 *     summary: Process / approve withdrawal request (Admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action: { type: string, enum: [approve, reject] }
 *               transactionReference: { type: string }
 *               adminNote: { type: string }
 *     responses:
 *       200:
 *         description: Withdrawal processed
 */
router.patch(
  "/admin/withdrawals/:id",
  checkAuth(...ADMIN_ROLES),
  validateRequest(processWithdrawalSchema),
  WalletControllers.processWithdrawal,
);

router.get(
  "/admin/cod-settlements",
  checkAuth(...ADMIN_ROLES),
  WalletControllers.getAllCodSettlementsAdmin,
);

router.patch(
  "/admin/cod-settlements/:id",
  checkAuth(...ADMIN_ROLES),
  validateRequest(confirmCodSettlementSchema),
  WalletControllers.confirmCodSettlement,
);

export const WalletRoutes = router;

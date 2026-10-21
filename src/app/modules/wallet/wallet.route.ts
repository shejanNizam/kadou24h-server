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

/**
 * @swagger
 * /wallets/me/summary:
 *   get:
 *     tags: [Wallet]
 *     summary: Earnings summary for the app (balances explained, today, chart series)
 *     description: |
 *       Vendor earnings = vendorEarning of sub-orders delivered in the period.
 *       Rider earnings = fee of delivery legs delivered in the period.
 *       Days and months are counted in Africa/Conakry time (UTC+0).
 *       Vendor balances add `inEscrow` and `awaitingCod` (delivered COD orders
 *       whose cash the rider still holds); rider balances add `cashOwed`,
 *       `cashLimit` and `withdrawable` (available minus cash owed).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: mode
 *         required: true
 *         schema: { type: string, enum: [vendor, rider] }
 *       - in: query
 *         name: range
 *         schema: { type: string, enum: ["7d", "30d", "6m", "12m"], default: "7d" }
 *         description: 7d/30d → one bucket per day, 6m/12m → one bucket per month
 *     responses:
 *       200:
 *         description: |
 *           `{ mode, range, timezone, balances, counts, today: { earnings, count },
 *           period: { from, to, earnings, count }, series: [{ key, earnings, count }] }`
 */
router.get("/me/summary", checkAuth(...APP_ROLES), WalletControllers.getMySummary);

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
 *             required: [amount, method]
 *             properties:
 *               amount: { type: integer, example: 250000, description: "≤ cash owed − already declared (pending)" }
 *               method: { type: string, enum: [orange_money, mobile_money, cash_at_office, earnings_offset] }
 *               reference: { type: string, example: "OM-TXN123456" }
 *               proofImage: { type: object, properties: { url: { type: string }, publicId: { type: string } } }
 *     responses:
 *       201:
 *         description: COD settlement submitted (earnings_offset is confirmed at once; the others wait for an admin)
 *   get:
 *     tags: [Wallet]
 *     summary: My COD cash hand-overs, newest first (Rider)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, rejected] }
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Paginated settlements
 */
router.post(
  "/me/cod-settlements",
  checkAuth(...APP_ROLES),
  validateRequest(submitCodSettlementSchema),
  WalletControllers.submitCodSettlement,
);
router.get("/me/cod-settlements", checkAuth(...APP_ROLES), WalletControllers.getMyCodSettlements);

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

/**
 * @swagger
 * /wallets/admin/cod-settlements/{id}:
 *   patch:
 *     tags: [Wallet]
 *     summary: Confirm (cash arrived) or reject a rider's COD hand-over (Admin)
 *     description: The rider is notified either way; a rejection needs a reason the rider sees.
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
 *               status: { type: string, enum: [confirmed, rejected] }
 *               rejectionReason: { type: string, description: "Required when rejected (3–300 chars)" }
 *     responses:
 *       200:
 *         description: Settlement decided (`releasedSubOrders` lists the store payments released)
 */
router.patch(
  "/admin/cod-settlements/:id",
  checkAuth(...ADMIN_ROLES),
  validateRequest(confirmCodSettlementSchema),
  WalletControllers.confirmCodSettlement,
);

export const WalletRoutes = router;

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

router.get("/me", checkAuth(...APP_ROLES), WalletControllers.getMyWallet);

// Payout Methods
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
router.get(
  "/me/transactions",
  checkAuth(...APP_ROLES),
  WalletControllers.getMyTransactions,
);

// COD Settlements
router.post(
  "/me/cod-settlements",
  checkAuth(...APP_ROLES),
  validateRequest(submitCodSettlementSchema),
  WalletControllers.submitCodSettlement,
);

// ── Admin Routes ──
router.get(
  "/admin/withdrawals",
  checkAuth(...ADMIN_ROLES),
  WalletControllers.getAllWithdrawalsAdmin,
);
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

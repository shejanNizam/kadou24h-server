import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { APP_ROLES } from "../user/user.interface";
import { WalletControllers } from "./wallet.controller";
import { addPayoutMethodZodSchema, updatePayoutMethodZodSchema } from "./wallet.validation";

const router = Router();

// Applicants are still "customer" — the wallet itself proves an application exists.

/**
 * @swagger
 * /wallets/me:
 *   get:
 *     tags: [Wallet]
 *     summary: My vendor or rider wallet (balances + payout methods)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: mode, required: true, schema: { type: string, enum: [vendor, rider] } }
 *     responses:
 *       200:
 *         description: Wallet
 *       404:
 *         description: No application started for this mode
 * /wallets/me/payout-methods:
 *   post:
 *     tags: [Wallet]
 *     summary: Add a payout method (Orange Money / Mobile Money / bank) — max 5, first is default
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PayoutMethodRequest'
 *     responses:
 *       201:
 *         description: Updated payout method list
 * /wallets/me/payout-methods/{methodId}:
 *   patch:
 *     tags: [Wallet]
 *     summary: Update a payout method (body must include mode)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: methodId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated payout method list
 *   delete:
 *     tags: [Wallet]
 *     summary: Delete a payout method
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: methodId, required: true, schema: { type: string } }
 *       - { in: query, name: mode, required: true, schema: { type: string, enum: [vendor, rider] } }
 *     responses:
 *       200:
 *         description: Updated payout method list
 */
router.get("/me", checkAuth(...APP_ROLES), WalletControllers.getMyWallet);
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

export const WalletRoutes = router;

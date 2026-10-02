import { Document, Types } from "mongoose";
import { PayoutMethodType } from "../settings/settings.interface";

export enum WalletMode {
  vendor = "vendor",
  rider = "rider",
}

export interface IPayoutMethod {
  _id?: Types.ObjectId;
  type: PayoutMethodType;
  accountName: string;
  accountNumber: string; // phone number for Orange Money / Mobile Money
  bankName?: string;
  isDefault: boolean;
}

export const MAX_PAYOUT_METHODS = 5;

// One wallet per user per earning mode. All amounts are whole GNF.
// Balances are a cache of the wallet_transactions ledger (Step 6).
export interface IWalletInitial {
  ownerId: Types.ObjectId;
  ownerMode: WalletMode;
  heldBalance: number; // escrow, not yet released
  availableBalance: number; // withdrawable
  totalEarned: number;
  totalCommission: number;
  totalWithdrawn: number;
  cashOwed: number; // riders: COD cash not yet handed to the platform
  payoutMethods: Types.DocumentArray<IPayoutMethod & Document>;
}

export type IWallet = IWalletInitial & Document;

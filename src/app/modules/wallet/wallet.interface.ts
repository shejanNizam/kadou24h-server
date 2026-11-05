import { Document, Types } from "mongoose";
import { IFileRef } from "../../interfaces/common.types";
import { PayoutMethodType } from "../settings/settings.interface";

export enum WalletMode {
  vendor = "vendor",
  rider = "rider",
}

export enum TransactionType {
  earning_held = "earning_held",
  earning_held_reversed = "earning_held_reversed",
  earning_released = "earning_released",
  commission = "commission",
  withdrawal = "withdrawal",
  withdrawal_fee = "withdrawal_fee",
  withdrawal_reversal = "withdrawal_reversal",
  refund_deduction = "refund_deduction",
  cod_collected = "cod_collected",
  cod_settled = "cod_settled",
  cod_offset = "cod_offset",
  adjustment = "adjustment",
}

/**
 * What a wallet line is, for the apps to describe it in the user's language
 * (with eventParams). `note` keeps an English text for the team and audits.
 */
export enum WalletEvent {
  sale_held = "sale_held",
  sale_released = "sale_released",
  commission = "commission",
  sale_cancelled = "sale_cancelled",
  sale_changed = "sale_changed",
  checkout_failed = "checkout_failed",
  refund = "refund",
  delivery_fee = "delivery_fee",
  cash_collected = "cash_collected",
  cash_offset = "cash_offset",
  cash_settled = "cash_settled",
  withdrawal = "withdrawal",
  withdrawal_fee = "withdrawal_fee",
  withdrawal_rejected = "withdrawal_rejected",
}

/** Values shown with a wallet event, e.g. { order: "AP12-1" } */
export type WalletEventParams = Record<string, string | number>;

export enum WithdrawalStatus {
  pending = "pending",
  approved = "approved",
  completed = "completed",
  rejected = "rejected",
}

export enum CodSettlementMethod {
  orange_money = "orange_money",
  mobile_money = "mobile_money",
  cash_at_office = "cash_at_office",
  earnings_offset = "earnings_offset",
}

export enum CodSettlementStatus {
  pending = "pending",
  confirmed = "confirmed",
  rejected = "rejected",
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

// Append-only ledger — SOURCE OF TRUTH for money movements
export interface IWalletTransactionInitial {
  walletId: Types.ObjectId;
  type: TransactionType;
  amount: number; // + credit / - debit
  balanceAfter: number;
  subOrderId?: Types.ObjectId;
  deliveryId?: Types.ObjectId;
  withdrawalId?: Types.ObjectId;
  settlementId?: Types.ObjectId;
  note?: string;
  event?: WalletEvent;
  eventParams?: WalletEventParams;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}

export type IWalletTransaction = IWalletTransactionInitial & Document;

export interface IWithdrawalInitial {
  requestNumber: string;
  walletId: Types.ObjectId;
  ownerId: Types.ObjectId;
  ownerMode: WalletMode;
  amount: number;
  fee: number;
  netAmount: number;
  payoutMethodSnapshot: {
    type: PayoutMethodType;
    accountName: string;
    accountNumber: string;
    bankName?: string;
  };
  status: WithdrawalStatus;
  rejectionReason?: string;
  transactionId?: string;
  receiptImage?: IFileRef;
  createdByAdmin: boolean;
  processedBy?: Types.ObjectId;
  processedAt?: Date;
}

export type IWithdrawal = IWithdrawalInitial & Document;

export interface ICodSettlementInitial {
  riderId: Types.ObjectId;
  amount: number;
  method: CodSettlementMethod;
  reference?: string;
  proofImage?: IFileRef;
  status: CodSettlementStatus;
  confirmedBy?: Types.ObjectId;
  confirmedAt?: Date;
  rejectionReason?: string; // shown to the rider
}

export type ICodSettlement = ICodSettlementInitial & Document;

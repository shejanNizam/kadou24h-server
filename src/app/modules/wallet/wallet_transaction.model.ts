import { Schema, model } from "mongoose";
import {
  IWalletTransaction,
  TransactionType,
  WalletEvent,
} from "./wallet.interface";

const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    subOrderId: {
      type: Schema.Types.ObjectId,
      ref: "sub_orders",
      index: true,
    },
    deliveryId: {
      type: Schema.Types.ObjectId,
      ref: "deliveries",
    },
    withdrawalId: {
      type: Schema.Types.ObjectId,
      ref: "withdrawals",
    },
    settlementId: {
      type: Schema.Types.ObjectId,
      ref: "cod_settlements",
    },
    note: {
      type: String,
      trim: true,
    },
    event: { type: String, enum: Object.values(WalletEvent) },
    eventParams: { type: Schema.Types.Mixed },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

walletTransactionSchema.index({ walletId: 1, createdAt: -1 });

export const WalletTransaction = model<IWalletTransaction>(
  "wallet_transactions",
  walletTransactionSchema,
);

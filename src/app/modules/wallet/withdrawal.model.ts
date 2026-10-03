import { Schema, model } from "mongoose";
import { fileRefSchema } from "../../utils/commonSchemas";
import { PayoutMethodType } from "../settings/settings.interface";
import {
  IWithdrawal,
  WalletMode,
  WithdrawalStatus,
} from "./wallet.interface";

const withdrawalSchema = new Schema<IWithdrawal>(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ownerMode: {
      type: String,
      enum: Object.values(WalletMode),
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    netAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    payoutMethodSnapshot: {
      type: {
        type: String,
        enum: Object.values(PayoutMethodType),
        required: true,
      },
      accountName: { type: String, required: true },
      accountNumber: { type: String, required: true },
      bankName: { type: String },
    },
    status: {
      type: String,
      enum: Object.values(WithdrawalStatus),
      default: WithdrawalStatus.pending,
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    transactionId: {
      type: String,
      trim: true,
    },
    receiptImage: {
      type: fileRefSchema,
    },
    createdByAdmin: {
      type: Boolean,
      default: false,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    processedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ ownerId: 1, createdAt: -1 });

export const Withdrawal = model<IWithdrawal>("withdrawals", withdrawalSchema);

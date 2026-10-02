import { model, Schema } from "mongoose";
import { PayoutMethodType } from "../settings/settings.interface";
import { IPayoutMethod, IWallet, MAX_PAYOUT_METHODS, WalletMode } from "./wallet.interface";

const payoutMethodSchema = new Schema<IPayoutMethod>({
  type: { type: String, enum: Object.values(PayoutMethodType), required: true },
  accountName: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  bankName: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
});

const walletSchema = new Schema<IWallet>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ownerMode: { type: String, enum: Object.values(WalletMode), required: true },
    heldBalance: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    cashOwed: { type: Number, default: 0 },
    payoutMethods: {
      type: [payoutMethodSchema],
      default: [],
      validate: {
        validator: (v: unknown[]) => v.length <= MAX_PAYOUT_METHODS,
        message: `You can save up to ${MAX_PAYOUT_METHODS} payout methods`,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

walletSchema.index({ ownerId: 1, ownerMode: 1 }, { unique: true });

export const Wallet = model<IWallet>("Wallet", walletSchema);

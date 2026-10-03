import z from "zod";
import { PayoutMethodType } from "../settings/settings.interface";
import { CodSettlementMethod, WalletMode } from "./wallet.interface";

const modeSchema = z.enum(Object.values(WalletMode) as [string, ...string[]]);

const payoutFields = {
  type: z.enum(Object.values(PayoutMethodType) as [string, ...string[]]),
  accountName: z.string().trim().min(2).max(80),
  accountNumber: z.string().trim().min(4).max(40),
  bankName: z.string().trim().max(80),
  isDefault: z.boolean(),
};

const requireBankName = (v: { type?: string; bankName?: string }) =>
  v.type !== PayoutMethodType.bank || !!v.bankName;

export const addPayoutMethodZodSchema = z
  .object({ mode: modeSchema, ...payoutFields })
  .partial({ bankName: true, isDefault: true })
  .strict()
  .refine(requireBankName, {
    message: "bankName is required for bank accounts",
    path: ["bankName"],
  });

export const updatePayoutMethodZodSchema = z
  .object({ mode: modeSchema, ...payoutFields })
  .partial()
  .required({ mode: true })
  .strict();

export const requestWithdrawalSchema = z.object({
  mode: modeSchema,
  amount: z.number().int().min(5000, "Minimum withdrawal amount is 5,000 GNF"),
  payoutMethodId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Valid payoutMethodId is required"),
});

export const processWithdrawalSchema = z.object({
  status: z.enum(["completed", "rejected"]),
  transactionId: z.string().optional(),
  receiptImage: z
    .object({
      url: z.string().url(),
      publicId: z.string(),
    })
    .optional(),
  rejectionReason: z.string().optional(),
});

export const submitCodSettlementSchema = z.object({
  amount: z.number().int().min(1, "Settlement amount must be at least 1 GNF"),
  method: z.enum(Object.values(CodSettlementMethod) as [string, ...string[]]),
  reference: z.string().optional(),
  proofImage: z
    .object({
      url: z.string().url(),
      publicId: z.string(),
    })
    .optional(),
});

export const confirmCodSettlementSchema = z.object({
  status: z.enum(["confirmed", "rejected"]),
});

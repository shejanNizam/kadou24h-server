import z from "zod";
import { PayoutMethodType } from "../settings/settings.interface";
import { WalletMode } from "./wallet.interface";

const modeSchema = z.enum(Object.values(WalletMode) as [string, ...string[]], {
  error: "mode must be vendor or rider",
});

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
  .refine(requireBankName, { message: "bankName is required for bank accounts", path: ["bankName"] });

export const updatePayoutMethodZodSchema = z
  .object({ mode: modeSchema, ...payoutFields })
  .partial()
  .required({ mode: true })
  .strict();

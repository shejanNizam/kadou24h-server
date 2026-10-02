import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { IPayoutMethod, MAX_PAYOUT_METHODS, WalletMode } from "./wallet.interface";
import { Wallet } from "./wallet.model";

/** Creates the wallet if missing. Called when a vendor / rider application starts. */
const ensureWallet = async (ownerId: string | Types.ObjectId, ownerMode: WalletMode) =>
  Wallet.findOneAndUpdate(
    { ownerId, ownerMode },
    { $setOnInsert: { ownerId, ownerMode } },
    { upsert: true, returnDocument: "after" },
  );

const getMyWallet = async (ownerId: string, ownerMode: WalletMode) => {
  const wallet = await Wallet.findOne({ ownerId, ownerMode });
  if (!wallet) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      `No ${ownerMode} wallet yet. Start your ${ownerMode} application first.`,
    );
  }
  return wallet;
};

const addPayoutMethod = async (
  ownerId: string,
  ownerMode: WalletMode,
  payload: Omit<IPayoutMethod, "_id" | "isDefault"> & { isDefault?: boolean },
) => {
  const wallet = await getMyWallet(ownerId, ownerMode);
  const methods = wallet.payoutMethods;

  if (methods.length >= MAX_PAYOUT_METHODS) {
    throw new AppError(httpStatus.BAD_REQUEST, `You can save up to ${MAX_PAYOUT_METHODS} payout methods`);
  }

  const makeDefault = payload.isDefault === true || methods.length === 0;
  if (makeDefault) methods.forEach((m) => (m.isDefault = false));

  methods.push({ ...payload, isDefault: makeDefault });
  await wallet.save();
  return wallet.payoutMethods;
};

const updatePayoutMethod = async (
  ownerId: string,
  ownerMode: WalletMode,
  methodId: string,
  payload: Partial<IPayoutMethod>,
) => {
  const wallet = await getMyWallet(ownerId, ownerMode);
  const method = wallet.payoutMethods.id(methodId);
  if (!method) throw new AppError(httpStatus.NOT_FOUND, "Payout method not found");

  const { isDefault, ...rest } = payload;
  method.set(rest);
  if (isDefault === true) {
    wallet.payoutMethods.forEach((m) => (m.isDefault = String(m._id) === methodId));
  }
  if (method.type === "bank" && !method.bankName) {
    throw new AppError(httpStatus.BAD_REQUEST, "bankName is required for bank accounts");
  }

  await wallet.save();
  return wallet.payoutMethods;
};

const deletePayoutMethod = async (ownerId: string, ownerMode: WalletMode, methodId: string) => {
  const wallet = await getMyWallet(ownerId, ownerMode);
  const method = wallet.payoutMethods.id(methodId);
  if (!method) throw new AppError(httpStatus.NOT_FOUND, "Payout method not found");

  const wasDefault = method.isDefault;
  method.deleteOne();
  if (wasDefault && wallet.payoutMethods.length > 0) wallet.payoutMethods[0].isDefault = true;

  await wallet.save();
  return wallet.payoutMethods;
};

export const WalletServices = {
  ensureWallet,
  getMyWallet,
  addPayoutMethod,
  updatePayoutMethod,
  deletePayoutMethod,
};

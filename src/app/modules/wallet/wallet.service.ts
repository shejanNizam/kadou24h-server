import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { emitToUser } from "../../../socket/socket";
import { CounterServices } from "../counter/counter.service";
import { DeliveryStatus } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { SettlementStatus } from "../order/order.interface";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SettingsServices } from "../settings/settings.service";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import {
  CodSettlementMethod,
  CodSettlementStatus,
  IPayoutMethod,
  IWallet,
  MAX_PAYOUT_METHODS,
  TransactionType,
  WalletMode,
  WithdrawalStatus,
} from "./wallet.interface";
import { Wallet } from "./wallet.model";
import { WalletTransaction } from "./wallet_transaction.model";
import { Withdrawal } from "./withdrawal.model";
import { CodSettlement } from "./cod_settlement.model";

/**
 * Creates the wallet if missing. Called when a vendor / rider application starts.
 */
const ensureWallet = async (
  ownerId: string | Types.ObjectId,
  ownerMode: WalletMode,
): Promise<IWallet> => {
  const result = await Wallet.findOneAndUpdate(
    { ownerId, ownerMode },
    { $setOnInsert: { ownerId, ownerMode } },
    { upsert: true, returnDocument: "after" },
  );
  return result as unknown as IWallet;
};

const getMyWallet = async (
  ownerId: string,
  ownerMode: WalletMode,
): Promise<IWallet> => {
  const wallet = await Wallet.findOne({ ownerId, ownerMode });
  if (!wallet) {
    return ensureWallet(ownerId, ownerMode);
  }
  return wallet as unknown as IWallet;
};

/**
 * Append-only ledger transaction recording. Updates wallet balances atomically.
 */
const recordTransaction = async (params: {
  walletId: Types.ObjectId | string;
  type: TransactionType;
  amount: number;
  subOrderId?: Types.ObjectId | string;
  deliveryId?: Types.ObjectId | string;
  withdrawalId?: Types.ObjectId | string;
  settlementId?: Types.ObjectId | string;
  note?: string;
  createdBy?: Types.ObjectId | string;
}) => {
  const wallet = await Wallet.findById(params.walletId);
  if (!wallet) throw new AppError(httpStatus.NOT_FOUND, "Wallet not found");

  const absAmount = Math.abs(params.amount);

  switch (params.type) {
    case TransactionType.earning_held:
      wallet.heldBalance += absAmount;
      wallet.totalEarned += absAmount;
      break;

    case TransactionType.earning_released:
      wallet.heldBalance = Math.max(0, wallet.heldBalance - absAmount);
      wallet.availableBalance += absAmount;
      break;

    case TransactionType.commission:
      wallet.totalCommission += absAmount;
      break;

    case TransactionType.withdrawal:
      wallet.availableBalance = Math.max(0, wallet.availableBalance - absAmount);
      wallet.totalWithdrawn += absAmount;
      break;

    case TransactionType.withdrawal_fee:
      wallet.availableBalance = Math.max(0, wallet.availableBalance - absAmount);
      break;

    case TransactionType.withdrawal_reversal:
      wallet.availableBalance += absAmount;
      wallet.totalWithdrawn = Math.max(0, wallet.totalWithdrawn - absAmount);
      break;

    case TransactionType.cod_collected:
      wallet.cashOwed += absAmount;
      break;

    case TransactionType.cod_settled:
      wallet.cashOwed = Math.max(0, wallet.cashOwed - absAmount);
      break;

    case TransactionType.cod_offset:
      wallet.cashOwed = Math.max(0, wallet.cashOwed - absAmount);
      wallet.availableBalance = Math.max(0, wallet.availableBalance - absAmount);
      break;

    case TransactionType.refund_deduction:
      wallet.availableBalance = Math.max(0, wallet.availableBalance - absAmount);
      break;

    case TransactionType.adjustment:
      if (params.amount >= 0) {
        wallet.availableBalance += absAmount;
      } else {
        wallet.availableBalance = Math.max(0, wallet.availableBalance - absAmount);
      }
      break;
  }

  await wallet.save();

  const txn = await WalletTransaction.create({
    walletId: wallet._id,
    type: params.type,
    amount: params.amount,
    balanceAfter: wallet.availableBalance,
    subOrderId: params.subOrderId,
    deliveryId: params.deliveryId,
    withdrawalId: params.withdrawalId,
    settlementId: params.settlementId,
    note: params.note,
    createdBy: params.createdBy,
  });

  return { wallet, transaction: txn };
};

/**
 * Releases escrow funds for a delivered sub-order.
 * Credits vendor's available balance and partner delivery fee.
 */
const releaseEscrowForSubOrder = async (
  subOrderId: string,
  actorId?: string,
) => {
  const subOrder = await SubOrder.findById(subOrderId);
  if (!subOrder) throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");

  if (subOrder.settlement === "released") {
    return { subOrder, message: "Escrow already released" };
  }

  // Look up vendor wallet
  const vendor = await VendorProfile.findById(subOrder.vendorId);
  if (vendor) {
    const vendorWallet = await ensureWallet(vendor.userId, WalletMode.vendor);

    // Release vendor earning from held to available
    await recordTransaction({
      walletId: vendorWallet._id,
      type: TransactionType.earning_released,
      amount: subOrder.vendorEarning,
      subOrderId: subOrder._id,
      note: `Escrow released for sub-order ${subOrder.subOrderNumber}`,
      createdBy: actorId,
    });

    // Record commission record in vendor wallet ledger
    await recordTransaction({
      walletId: vendorWallet._id,
      type: TransactionType.commission,
      amount: subOrder.commissionAmount,
      subOrderId: subOrder._id,
      note: `Platform commission for sub-order ${subOrder.subOrderNumber}`,
      createdBy: actorId,
    });
  }

  // Credit delivery partners for each completed leg of this sub-order
  const legs = await Delivery.find({
    subOrderId: subOrder._id,
    status: DeliveryStatus.delivered,
  });

  for (const leg of legs) {
    if (leg.riderId && leg.fee > 0) {
      const rider = await RiderProfile.findById(leg.riderId);
      if (rider) {
        const riderWallet = await ensureWallet(rider.userId, WalletMode.rider);

        // Credit rider delivery fee (100% of delivery fee goes to rider)
        await recordTransaction({
          walletId: riderWallet._id,
          type: TransactionType.earning_released,
          amount: leg.fee,
          deliveryId: leg._id,
          subOrderId: subOrder._id,
          note: `Delivery fee earned for leg #${leg.legNumber}`,
          createdBy: actorId,
        });

        // If leg was COD and collected cash
        if (leg.collectsCash && subOrder.codAmountToCollect) {
          await recordTransaction({
            walletId: riderWallet._id,
            type: TransactionType.cod_collected,
            amount: subOrder.codAmountToCollect,
            deliveryId: leg._id,
            subOrderId: subOrder._id,
            note: `COD cash collected for ${subOrder.subOrderNumber}`,
            createdBy: actorId,
          });
        }
      }
    }
  }

  subOrder.settlement = SettlementStatus.released;
  subOrder.releasedAt = new Date();
  await subOrder.save();

  return { subOrder };
};

/**
 * Payout methods management
 */
const addPayoutMethod = async (
  ownerId: string,
  ownerMode: WalletMode,
  payload: Omit<IPayoutMethod, "_id" | "isDefault"> & { isDefault?: boolean },
) => {
  const wallet = await getMyWallet(ownerId, ownerMode);
  const methods = wallet.payoutMethods;

  if (methods.length >= MAX_PAYOUT_METHODS) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `You can save up to ${MAX_PAYOUT_METHODS} payout methods`,
    );
  }

  const makeDefault = payload.isDefault === true || methods.length === 0;
  if (makeDefault) methods.forEach((m) => (m.isDefault = false));

  methods.push({ ...payload, isDefault: makeDefault } as any);
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

const deletePayoutMethod = async (
  ownerId: string,
  ownerMode: WalletMode,
  methodId: string,
) => {
  const wallet = await getMyWallet(ownerId, ownerMode);
  const method = wallet.payoutMethods.id(methodId);
  if (!method) throw new AppError(httpStatus.NOT_FOUND, "Payout method not found");

  const wasDefault = method.isDefault;
  method.deleteOne();
  if (wasDefault && wallet.payoutMethods.length > 0) {
    wallet.payoutMethods[0].isDefault = true;
  }

  await wallet.save();
  return wallet.payoutMethods;
};

/**
 * Requests a payout/withdrawal from available wallet balance.
 */
const requestWithdrawal = async (
  ownerId: string,
  payload: {
    mode: WalletMode;
    amount: number;
    payoutMethodId: string;
  },
) => {
  const wallet = await getMyWallet(ownerId, payload.mode);

  if (wallet.availableBalance < payload.amount) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Insufficient available balance. Available: ${wallet.availableBalance} GNF, requested: ${payload.amount} GNF`,
    );
  }

  const payoutMethod = wallet.payoutMethods.id(payload.payoutMethodId);
  if (!payoutMethod) {
    throw new AppError(httpStatus.NOT_FOUND, "Selected payout method not found");
  }

  // Calculate withdrawal fee
  const settings = await SettingsServices.getSettings();
  const feeRule = settings.withdrawalFees?.find(
    (f) => f.method === payoutMethod.type,
  );

  let fee = 0;
  if (feeRule) {
    if (feeRule.type === "percent") {
      fee = Math.round(payload.amount * (feeRule.value / 100));
    } else {
      fee = feeRule.value;
    }
  }

  const netAmount = Math.max(0, payload.amount - fee);
  const requestNumber = await CounterServices.nextCode("withdrawal");

  const withdrawal = await Withdrawal.create({
    requestNumber,
    walletId: wallet._id,
    ownerId: new Types.ObjectId(ownerId),
    ownerMode: payload.mode,
    amount: payload.amount,
    fee,
    netAmount,
    payoutMethodSnapshot: {
      type: payoutMethod.type,
      accountName: payoutMethod.accountName,
      accountNumber: payoutMethod.accountNumber,
      bankName: payoutMethod.bankName,
    },
    status: WithdrawalStatus.pending,
    createdByAdmin: false,
  });

  // Deduct from wallet immediately
  await recordTransaction({
    walletId: wallet._id,
    type: TransactionType.withdrawal,
    amount: payload.amount,
    withdrawalId: withdrawal._id,
    note: `Withdrawal request ${requestNumber}`,
    createdBy: ownerId,
  });

  if (fee > 0) {
    await recordTransaction({
      walletId: wallet._id,
      type: TransactionType.withdrawal_fee,
      amount: fee,
      withdrawalId: withdrawal._id,
      note: `Fee for withdrawal request ${requestNumber}`,
      createdBy: ownerId,
    });
  }

  emitToUser(ownerId, "withdrawal:requested", {
    withdrawalId: withdrawal._id,
    requestNumber,
    amount: payload.amount,
    netAmount,
  });

  return withdrawal;
};

/**
 * Admin processes withdrawal request (completes with txn ID or rejects and refunds balance).
 */
const processWithdrawal = async (
  adminUserId: string,
  withdrawalId: string,
  payload: {
    status: "completed" | "rejected";
    transactionId?: string;
    receiptImage?: { url: string; publicId: string };
    rejectionReason?: string;
  },
) => {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal) throw new AppError(httpStatus.NOT_FOUND, "Withdrawal request not found");

  if (withdrawal.status !== WithdrawalStatus.pending) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Withdrawal has already been ${withdrawal.status}`,
    );
  }

  if (payload.status === "completed") {
    withdrawal.status = WithdrawalStatus.completed;
    withdrawal.transactionId = payload.transactionId;
    withdrawal.receiptImage = payload.receiptImage;
    withdrawal.processedBy = new Types.ObjectId(adminUserId);
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    emitToUser(String(withdrawal.ownerId), "withdrawal:completed", {
      withdrawalId: withdrawal._id,
      requestNumber: withdrawal.requestNumber,
      transactionId: payload.transactionId,
    });
  } else {
    // Rejected: reverse funds back to wallet
    withdrawal.status = WithdrawalStatus.rejected;
    withdrawal.rejectionReason = payload.rejectionReason || "Rejected by administrator";
    withdrawal.processedBy = new Types.ObjectId(adminUserId);
    withdrawal.processedAt = new Date();
    await withdrawal.save();

    await recordTransaction({
      walletId: withdrawal.walletId,
      type: TransactionType.withdrawal_reversal,
      amount: withdrawal.amount,
      withdrawalId: withdrawal._id,
      note: `Reversal of rejected withdrawal ${withdrawal.requestNumber}: ${withdrawal.rejectionReason}`,
      createdBy: adminUserId,
    });

    emitToUser(String(withdrawal.ownerId), "withdrawal:rejected", {
      withdrawalId: withdrawal._id,
      requestNumber: withdrawal.requestNumber,
      reason: withdrawal.rejectionReason,
    });
  }

  return withdrawal;
};

/**
 * Rider submits a COD settlement or offsets against earnings.
 */
const submitCodSettlement = async (
  riderUserId: string,
  payload: {
    amount: number;
    method: CodSettlementMethod;
    reference?: string;
    proofImage?: { url: string; publicId: string };
  },
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const wallet = await getMyWallet(riderUserId, WalletMode.rider);

  if (payload.method === CodSettlementMethod.earnings_offset) {
    // Direct offset against available balance
    if (wallet.availableBalance < payload.amount) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Insufficient available balance for offset. Available: ${wallet.availableBalance} GNF, offset: ${payload.amount} GNF`,
      );
    }

    if (wallet.cashOwed < payload.amount) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Offset amount cannot exceed cash owed (${wallet.cashOwed} GNF)`,
      );
    }

    const settlement = await CodSettlement.create({
      riderId: rider._id,
      amount: payload.amount,
      method: CodSettlementMethod.earnings_offset,
      reference: "OFFSET_EARNINGS",
      status: CodSettlementStatus.confirmed,
      confirmedAt: new Date(),
    });

    await recordTransaction({
      walletId: wallet._id,
      type: TransactionType.cod_offset,
      amount: payload.amount,
      settlementId: settlement._id,
      note: "Offset COD cash owed against available earnings",
      createdBy: riderUserId,
    });

    return settlement;
  }

  // Other settlement methods: pending admin verification
  const settlement = await CodSettlement.create({
    riderId: rider._id,
    amount: payload.amount,
    method: payload.method,
    reference: payload.reference,
    proofImage: payload.proofImage,
    status: CodSettlementStatus.pending,
  });

  return settlement;
};

/**
 * Admin confirms or rejects a COD cash settlement from a rider.
 */
const confirmCodSettlement = async (
  adminUserId: string,
  settlementId: string,
  status: "confirmed" | "rejected",
) => {
  const settlement = await CodSettlement.findById(settlementId);
  if (!settlement) throw new AppError(httpStatus.NOT_FOUND, "Settlement not found");

  if (settlement.status !== CodSettlementStatus.pending) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Settlement is already ${settlement.status}`,
    );
  }

  if (status === "confirmed") {
    settlement.status = CodSettlementStatus.confirmed;
    settlement.confirmedBy = new Types.ObjectId(adminUserId);
    settlement.confirmedAt = new Date();
    await settlement.save();

    const rider = await RiderProfile.findById(settlement.riderId);
    if (rider) {
      const wallet = await getMyWallet(String(rider.userId), WalletMode.rider);

      await recordTransaction({
        walletId: wallet._id,
        type: TransactionType.cod_settled,
        amount: settlement.amount,
        settlementId: settlement._id,
        note: `COD cash settlement confirmed (${settlement.method})`,
        createdBy: adminUserId,
      });

      emitToUser(String(rider.userId), "cod_settlement:confirmed", {
        settlementId: settlement._id,
        amount: settlement.amount,
      });
    }
  } else {
    settlement.status = CodSettlementStatus.rejected;
    await settlement.save();
  }

  return settlement;
};

/**
 * Ledger history and transaction listing
 */
const getMyTransactions = async (
  ownerId: string,
  ownerMode: WalletMode,
  query: { page?: number; limit?: number; type?: TransactionType },
) => {
  const wallet = await getMyWallet(ownerId, ownerMode);

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { walletId: wallet._id };
  if (query.type) filter.type = query.type;

  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    WalletTransaction.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: transactions,
  };
};

const getMyWithdrawals = async (
  ownerId: string,
  ownerMode: WalletMode,
  query: { page?: number; limit?: number; status?: WithdrawalStatus },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    ownerId: new Types.ObjectId(ownerId),
    ownerMode,
  };
  if (query.status) filter.status = query.status;

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Withdrawal.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: withdrawals,
  };
};

const getAllWithdrawalsAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: WithdrawalStatus;
  ownerMode?: WalletMode;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.ownerMode) filter.ownerMode = query.ownerMode;

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .populate("ownerId", "name phone email avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Withdrawal.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: withdrawals,
  };
};

const getAllCodSettlementsAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: CodSettlementStatus;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const [settlements, total] = await Promise.all([
    CodSettlement.find(filter)
      .populate("riderId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    CodSettlement.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: settlements,
  };
};

export const WalletServices = {
  ensureWallet,
  getMyWallet,
  recordTransaction,
  releaseEscrowForSubOrder,
  addPayoutMethod,
  updatePayoutMethod,
  deletePayoutMethod,
  requestWithdrawal,
  processWithdrawal,
  submitCodSettlement,
  confirmCodSettlement,
  getMyTransactions,
  getMyWithdrawals,
  getAllWithdrawalsAdmin,
  getAllCodSettlementsAdmin,
};

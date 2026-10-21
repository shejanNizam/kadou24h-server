import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { emitToUser } from "../../../socket/socket";
import { Notify } from "../notification/notification.events";
import { AppMode } from "../user/user.interface";
import { CounterServices } from "../counter/counter.service";
import { DeliveryStatus } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { ISubOrder, SettlementStatus } from "../order/order.interface";
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
import { containsRegex } from "../../utils/queryParams";

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
  const absAmount = Math.abs(params.amount);

  // field += amount, or field -= amount without going below 0
  const add = (field: string, amount: number) => ({ $add: [`$${field}`, amount] });
  const subtract = (field: string, amount: number) => ({
    $max: [0, { $subtract: [`$${field}`, amount] }],
  });

  const changes: Record<TransactionType, Record<string, unknown>> = {
    [TransactionType.earning_held]: {
      heldBalance: add("heldBalance", absAmount),
      totalEarned: add("totalEarned", absAmount),
    },
    [TransactionType.earning_held_reversed]: {
      heldBalance: subtract("heldBalance", absAmount),
      totalEarned: subtract("totalEarned", absAmount),
    },
    [TransactionType.earning_released]: {
      heldBalance: subtract("heldBalance", absAmount),
      availableBalance: add("availableBalance", absAmount),
    },
    [TransactionType.commission]: { totalCommission: add("totalCommission", absAmount) },
    [TransactionType.withdrawal]: {
      availableBalance: subtract("availableBalance", absAmount),
      totalWithdrawn: add("totalWithdrawn", absAmount),
    },
    [TransactionType.withdrawal_fee]: { availableBalance: subtract("availableBalance", absAmount) },
    [TransactionType.withdrawal_reversal]: {
      availableBalance: add("availableBalance", absAmount),
      totalWithdrawn: subtract("totalWithdrawn", absAmount),
    },
    [TransactionType.cod_collected]: { cashOwed: add("cashOwed", absAmount) },
    [TransactionType.cod_settled]: { cashOwed: subtract("cashOwed", absAmount) },
    [TransactionType.cod_offset]: {
      cashOwed: subtract("cashOwed", absAmount),
      availableBalance: subtract("availableBalance", absAmount),
    },
    [TransactionType.refund_deduction]: { availableBalance: subtract("availableBalance", absAmount) },
    [TransactionType.adjustment]: {
      availableBalance:
        params.amount >= 0
          ? add("availableBalance", absAmount)
          : subtract("availableBalance", absAmount),
    },
  };

  // One atomic update — two transactions on the same wallet at once cannot
  // overwrite each other (a read-modify-save here would lose one of them)
  const wallet = await Wallet.findOneAndUpdate(
    { _id: params.walletId },
    [{ $set: changes[params.type] }],
    { returnDocument: "after", updatePipeline: true },
  );
  if (!wallet) throw new AppError(httpStatus.NOT_FOUND, "Wallet not found");


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
 * Moves a sub-order's vendor earning from held to available and records the
 * platform commission. Only called once the money is really with the platform:
 * at delivery for prepaid orders, after the rider's cash is settled for COD.
 */
const releaseVendorEarning = async (subOrder: ISubOrder, actorId?: string) => {
  // Claim the sub-order first so a concurrent call cannot release twice
  const claimed = await SubOrder.findOneAndUpdate(
    {
      _id: subOrder._id,
      settlement: { $in: [SettlementStatus.held, SettlementStatus.awaiting_cod] },
    },
    { $set: { settlement: SettlementStatus.released, releasedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) return null;

  const vendor = await VendorProfile.findById(claimed.vendorId);
  if (!vendor) {
    throw new AppError(httpStatus.NOT_FOUND, `Vendor of ${claimed.subOrderNumber} not found`);
  }
  const vendorWallet = await ensureWallet(vendor.userId, WalletMode.vendor);

  await recordTransaction({
    walletId: vendorWallet._id,
    type: TransactionType.earning_released,
    amount: claimed.vendorEarning,
    subOrderId: claimed._id,
    note: `Escrow released for sub-order ${claimed.subOrderNumber}`,
    createdBy: actorId,
  });

  await recordTransaction({
    walletId: vendorWallet._id,
    type: TransactionType.commission,
    amount: claimed.commissionAmount,
    subOrderId: claimed._id,
    note: `Platform commission for sub-order ${claimed.subOrderNumber}`,
    createdBy: actorId,
  });

  emitToUser(String(vendor.userId), "wallet:earning_released", {
    subOrderId: claimed._id,
    amount: claimed.vendorEarning,
  });
  Notify.earningsUpdated(
    vendor.userId,
    AppMode.vendor,
    claimed.vendorEarning,
    { fr: `commande ${claimed.subOrderNumber} payée`, en: `order ${claimed.subOrderNumber} paid out` },
    { subOrderId: String(claimed._id) },
  );

  return claimed;
};

/**
 * Called when the final delivery leg is handed over.
 * - Every rider who completed a leg is paid their leg fee (100%).
 * - Prepaid order → the vendor earning is released now.
 * - COD order     → the collecting rider's cashOwed grows by the cash amount and
 *                   the vendor earning waits (`awaiting_cod`) until the rider's
 *                   cash settlements cover it (see applyCodRemittance).
 */
const releaseEscrowForSubOrder = async (subOrderId: string, actorId?: string) => {
  const subOrder = await SubOrder.findById(subOrderId);
  if (!subOrder) throw new AppError(httpStatus.NOT_FOUND, "Sub-order not found");

  if (subOrder.settlement !== SettlementStatus.held) {
    return { subOrder, message: `Settlement already ${subOrder.settlement}` };
  }

  // Claim the sub-order before paying anyone, so a second call pays nothing
  const isCodPending = Boolean(subOrder.codAmountToCollect && subOrder.codCollectedBy);
  const claimed = isCodPending
    ? await SubOrder.findOneAndUpdate(
        { _id: subOrder._id, settlement: SettlementStatus.held },
        { $set: { settlement: SettlementStatus.awaiting_cod } },
        { returnDocument: "after" },
      )
    : await releaseVendorEarning(subOrder, actorId);
  if (!claimed) {
    return { subOrder, message: "Settlement already handled" };
  }

  const legs = await Delivery.find({
    subOrderId: subOrder._id,
    status: DeliveryStatus.delivered,
  });

  for (const leg of legs) {
    if (!leg.riderId) continue;
    const rider = await RiderProfile.findById(leg.riderId);
    if (!rider) continue;
    const riderWallet = await ensureWallet(rider.userId, WalletMode.rider);

    if (leg.fee > 0) {
      await recordTransaction({
        walletId: riderWallet._id,
        type: TransactionType.earning_released,
        amount: leg.fee,
        deliveryId: leg._id,
        subOrderId: subOrder._id,
        note: `Delivery fee earned for leg #${leg.legNumber}`,
        createdBy: actorId,
      });
      Notify.earningsUpdated(
        rider.userId,
        AppMode.rider,
        leg.fee,
        { fr: `livraison ${subOrder.subOrderNumber}`, en: `delivery ${subOrder.subOrderNumber}` },
        { deliveryId: String(leg._id) },
      );
    }

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

  if (isCodPending) {
    return { subOrder: claimed, message: "Vendor earning waits for the rider's COD cash settlement" };
  }
  return { subOrder: claimed };
};

/**
 * Allocates cash a rider has handed over (settlement or earnings offset) to their
 * delivered COD sub-orders, oldest first. Every sub-order whose cash is now fully
 * covered releases its vendor earning. Returns the sub-orders that were released.
 */
const applyCodRemittance = async (
  riderProfileId: Types.ObjectId | string,
  amount: number,
  actorId?: string,
) => {
  let remaining = amount;
  const released: string[] = [];

  const pending = await SubOrder.find({
    codCollectedBy: riderProfileId,
    settlement: SettlementStatus.awaiting_cod,
  }).sort({ codCollectedAt: 1 });

  for (const subOrder of pending) {
    if (remaining <= 0) break;

    const due = (subOrder.codAmountToCollect ?? 0) - (subOrder.codRemittedAmount ?? 0);
    if (due <= 0) continue;

    const take = Math.min(due, remaining);
    remaining -= take;

    subOrder.codRemittedAmount = (subOrder.codRemittedAmount ?? 0) + take;
    const isCovered = subOrder.codRemittedAmount >= (subOrder.codAmountToCollect ?? 0);
    if (isCovered) subOrder.codSettledAt = new Date();
    await subOrder.save();

    if (isCovered) {
      await releaseVendorEarning(subOrder, actorId);
      released.push(subOrder.subOrderNumber);
    }
  }

  return { released, unallocated: remaining };
};

/**
 * Reverses escrow funds for a cancelled sub-order.
 * Decrements vendor heldBalance and totalEarned, and marks settlement as cancelled.
 */
const reverseEscrowForSubOrder = async (
  subOrderId: string,
  actorId: string,
) => {
  const subOrder = await SubOrder.findById(subOrderId);
  if (!subOrder) return null;

  if (subOrder.settlement === SettlementStatus.released) {
    return { subOrder, message: "Escrow was already released; handle via refund" };
  }

  if (
    subOrder.settlement === SettlementStatus.refunded ||
    subOrder.settlement === SettlementStatus.cancelled
  ) {
    return { subOrder, message: "Escrow already reversed or cancelled" };
  }

  const vendor = await VendorProfile.findById(subOrder.vendorId);
  if (vendor && subOrder.vendorEarning > 0) {
    const vendorWallet = await ensureWallet(vendor.userId, WalletMode.vendor);
    await recordTransaction({
      walletId: vendorWallet._id,
      type: TransactionType.earning_held_reversed,
      amount: subOrder.vendorEarning,
      subOrderId: subOrder._id,
      note: `Escrow reversed for cancelled sub-order ${subOrder.subOrderNumber}`,
      createdBy: actorId,
    });
  }

  subOrder.settlement = SettlementStatus.cancelled;
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

  methods.push(methods.create({ ...payload, isDefault: makeDefault }));
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
 * Uses atomic MongoDB operations, prevents double-fee deduction, and guards against outstanding rider COD cash.
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

  // Guard against rider unpaid cash debt: rider cannot withdraw if they hold unremitted COD cash
  if (payload.mode === WalletMode.rider && (wallet.cashOwed || 0) > 0) {
    const maxWithdrawable = Math.max(0, wallet.availableBalance - (wallet.cashOwed || 0));
    if (payload.amount > maxWithdrawable) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Cannot withdraw ${payload.amount.toLocaleString()} GNF: you owe ${wallet.cashOwed.toLocaleString()} GNF in unremitted COD cash. Maximum withdrawable: ${maxWithdrawable.toLocaleString()} GNF`,
      );
    }
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

  // Net amount user receives = requested gross amount minus fee
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

  // Atomic deduction from wallet: prevents race conditions and overdrafts
  // Total deduction from availableBalance is payload.amount (netAmount + fee)
  const updatedWallet = await Wallet.findOneAndUpdate(
    {
      _id: wallet._id,
      availableBalance: { $gte: payload.amount },
    },
    {
      $inc: {
        availableBalance: -payload.amount,
        totalWithdrawn: payload.amount, // reversal subtracts the same full amount
      },
    },
    { new: true },
  );

  if (!updatedWallet) {
    await Withdrawal.findByIdAndDelete(withdrawal._id);
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Insufficient available balance or concurrent withdrawal in progress.`,
    );
  }

  // Record net withdrawal transaction
  await WalletTransaction.create({
    walletId: wallet._id,
    type: TransactionType.withdrawal,
    amount: netAmount,
    balanceAfter: updatedWallet.availableBalance + fee,
    withdrawalId: withdrawal._id,
    note: `Withdrawal request ${requestNumber} (net payout)`,
    createdBy: ownerId,
  });

  // Record platform withdrawal fee if applicable (part of total requested amount, NOT charged on top)
  if (fee > 0) {
    await WalletTransaction.create({
      walletId: wallet._id,
      type: TransactionType.withdrawal_fee,
      amount: fee,
      balanceAfter: updatedWallet.availableBalance,
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

  // Claim it atomically — two admins processing at once cannot both reverse the funds
  const processed = await Withdrawal.findOneAndUpdate(
    { _id: withdrawal._id, status: WithdrawalStatus.pending },
    {
      $set: {
        processedBy: new Types.ObjectId(adminUserId),
        processedAt: new Date(),
        ...(payload.status === "completed"
          ? {
              status: WithdrawalStatus.completed,
              transactionId: payload.transactionId,
              receiptImage: payload.receiptImage,
            }
          : {
              status: WithdrawalStatus.rejected,
              rejectionReason: payload.rejectionReason || "Rejected by administrator",
            }),
      },
    },
    { returnDocument: "after" },
  );
  if (!processed) {
    throw new AppError(httpStatus.CONFLICT, "Withdrawal was just processed by someone else");
  }

  if (payload.status === "completed") {
    emitToUser(String(processed.ownerId), "withdrawal:completed", {
      withdrawalId: processed._id,
      requestNumber: processed.requestNumber,
      transactionId: payload.transactionId,
    });
    Notify.withdrawalProcessed(processed, "completed");
  } else {
    const withdrawal = processed;
    // Rejected: reverse funds back to wallet
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
    Notify.withdrawalProcessed(withdrawal, "rejected", withdrawal.rejectionReason);
  }

  return processed;
};

/**
 * Rider hands over collected COD cash: by Orange Money / Mobile Money / office
 * deposit (pending admin confirmation) or by offsetting it against earnings
 * (instant). Confirmed cash is allocated to the rider's COD sub-orders and
 * releases the matching vendor earnings.
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

  // Cash already declared but not yet confirmed cannot be declared again
  const [pendingAgg] = await CodSettlement.aggregate<{ total: number }>([
    { $match: { riderId: rider._id, status: CodSettlementStatus.pending } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const outstanding = (wallet.cashOwed || 0) - (pendingAgg?.total ?? 0);
  if (payload.amount > outstanding) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Settlement amount cannot exceed the cash you still owe (${Math.max(0, outstanding)} GNF)`,
    );
  }

  if (payload.method === CodSettlementMethod.earnings_offset) {
    // Atomic: both balances must still cover the offset at write time
    const updated = await Wallet.findOneAndUpdate(
      {
        _id: wallet._id,
        availableBalance: { $gte: payload.amount },
        cashOwed: { $gte: payload.amount },
      },
      { $inc: { availableBalance: -payload.amount, cashOwed: -payload.amount } },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Insufficient available balance for offset. Available: ${wallet.availableBalance} GNF`,
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

    await WalletTransaction.create({
      walletId: wallet._id,
      type: TransactionType.cod_offset,
      amount: payload.amount,
      balanceAfter: updated.availableBalance,
      settlementId: settlement._id,
      note: "Offset COD cash owed against available earnings",
      createdBy: riderUserId,
    });

    const allocation = await applyCodRemittance(rider._id, payload.amount, riderUserId);
    return { ...settlement.toObject(), releasedSubOrders: allocation.released };
  }

  // Other methods wait for an admin to confirm the money arrived
  const settlement = await CodSettlement.create({
    riderId: rider._id,
    amount: payload.amount,
    method: payload.method,
    reference: payload.reference,
    proofImage: payload.proofImage,
    status: CodSettlementStatus.pending,
  });

  return { ...settlement.toObject(), releasedSubOrders: [] };
};

/**
 * Admin confirms or rejects a COD cash settlement from a rider.
 * Confirming reduces the rider's cashOwed and releases covered vendor earnings.
 */
const confirmCodSettlement = async (
  adminUserId: string,
  settlementId: string,
  status: "confirmed" | "rejected",
  rejectionReason?: string,
) => {
  // Claim the pending settlement atomically so it can never be confirmed twice
  const settlement = await CodSettlement.findOneAndUpdate(
    { _id: settlementId, status: CodSettlementStatus.pending },
    {
      $set: {
        status:
          status === "confirmed" ? CodSettlementStatus.confirmed : CodSettlementStatus.rejected,
        confirmedBy: new Types.ObjectId(adminUserId),
        confirmedAt: new Date(),
        ...(status === "rejected" && rejectionReason && { rejectionReason }),
      },
    },
    { returnDocument: "after" },
  );

  if (!settlement) {
    const existing = await CodSettlement.findById(settlementId);
    if (!existing) throw new AppError(httpStatus.NOT_FOUND, "Settlement not found");
    throw new AppError(httpStatus.BAD_REQUEST, `Settlement is already ${existing.status}`);
  }

  const rider = await RiderProfile.findById(settlement.riderId);
  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "Rider profile not found");

  if (status !== "confirmed") {
    // The cash is still owed: the rider must declare it again (or explain)
    Notify.codSettlementProcessed(rider.userId, settlement, "rejected", rejectionReason);
    emitToUser(String(rider.userId), "cod_settlement:rejected", {
      settlementId: settlement._id,
      amount: settlement.amount,
    });
    return { ...settlement.toObject(), releasedSubOrders: [] };
  }

  const wallet = await getMyWallet(String(rider.userId), WalletMode.rider);
  await recordTransaction({
    walletId: wallet._id,
    type: TransactionType.cod_settled,
    amount: settlement.amount,
    settlementId: settlement._id,
    note: `COD cash settlement confirmed (${settlement.method})`,
    createdBy: adminUserId,
  });

  const allocation = await applyCodRemittance(rider._id, settlement.amount, adminUserId);

  Notify.codSettlementProcessed(rider.userId, settlement, "confirmed");
  emitToUser(String(rider.userId), "cod_settlement:confirmed", {
    settlementId: settlement._id,
    amount: settlement.amount,
  });

  return { ...settlement.toObject(), releasedSubOrders: allocation.released };
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: transactions,
  };
};

/** Rider: my cash hand-overs (pending / confirmed / rejected), newest first, plus what I still owe. */
const getMyCodSettlements = async (
  riderUserId: string,
  query: { page?: number; limit?: number; status?: CodSettlementStatus },
) => {
  const rider = await RiderProfile.findOne({ userId: riderUserId }).select("_id");
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "Rider profile not found");

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const filter: Record<string, unknown> = { riderId: rider._id };
  if (query.status) filter.status = query.status;

  const [settlements, total] = await Promise.all([
    CodSettlement.find(filter)
      .select("-confirmedBy")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CodSettlement.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: settlements,
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
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: withdrawals,
  };
};

const getAllWithdrawalsAdmin = async (query: {
  page?: number;
  limit?: number;
  status?: WithdrawalStatus;
  ownerMode?: WalletMode;
  method?: string;
  search?: string;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.ownerMode) filter.ownerMode = query.ownerMode;
  if (query.method) filter["payoutMethodSnapshot.type"] = query.method;
  if (query.search) {
    const text = containsRegex(query.search);
    filter.$or = [
      { requestNumber: text },
      { "payoutMethodSnapshot.accountNumber": text },
      { "payoutMethodSnapshot.accountName": text },
    ];
  }

  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .populate("ownerId", "name phone email avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Withdrawal.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
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
      .populate({
        path: "riderId",
        select: "userId partnerType vehicle cityArea",
        populate: { path: "userId", select: "name phone avatar" },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    CodSettlement.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: settlements,
  };
};

/** The balances an admin needs on a vendor / rider profile. */
export const walletSummary = (wallet: IWallet) => ({
  availableBalance: wallet.availableBalance,
  heldBalance: wallet.heldBalance,
  totalEarned: wallet.totalEarned,
  totalWithdrawn: wallet.totalWithdrawn,
  totalCommission: wallet.totalCommission,
  cashOwed: wallet.cashOwed,
});

export const WalletServices = {
  ensureWallet,
  getMyWallet,
  recordTransaction,
  releaseEscrowForSubOrder,
  releaseVendorEarning,
  applyCodRemittance,
  reverseEscrowForSubOrder,
  addPayoutMethod,
  updatePayoutMethod,
  deletePayoutMethod,
  requestWithdrawal,
  processWithdrawal,
  submitCodSettlement,
  confirmCodSettlement,
  getMyCodSettlements,
  getMyTransactions,
  getMyWithdrawals,
  getAllWithdrawalsAdmin,
  getAllCodSettlementsAdmin,
};

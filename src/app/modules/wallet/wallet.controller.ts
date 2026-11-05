import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import {
  CodSettlementStatus,
  TransactionType,
  WalletMode,
  WithdrawalStatus,
} from "./wallet.interface";
import { WalletServices } from "./wallet.service";
import { SUMMARY_RANGES, WalletSummaryServices } from "./wallet.summary.service";
import { enumQuery, queryString } from "../../utils/queryParams";
import { PayoutMethodType } from "../settings/settings.interface";

const modeFromQuery = (req: Request) => {
  const mode = req.query.mode as WalletMode;
  if (!Object.values(WalletMode).includes(mode)) {
    throw new AppError(httpStatus.BAD_REQUEST, "WALLET_MODE_INVALID");
  }
  return mode;
};

const getMyWallet = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.getMyWallet(req.user._id, modeFromQuery(req));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Wallet retrieved successfully!",
    data: result,
  });
});

const getMySummary = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletSummaryServices.getMySummary(
    req.user._id,
    modeFromQuery(req),
    enumQuery(req.query.range, SUMMARY_RANGES, "range"),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Earnings summary retrieved successfully!",
    data: result,
  });
});

const addPayoutMethod = catchAsync(async (req: Request, res: Response) => {
  const { mode, ...payload } = req.body;
  const result = await WalletServices.addPayoutMethod(req.user._id, mode, payload);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Payout method added successfully!",
    data: result,
  });
});

const updatePayoutMethod = catchAsync(async (req: Request, res: Response) => {
  const { mode, ...payload } = req.body;
  const result = await WalletServices.updatePayoutMethod(
    req.user._id,
    mode,
    req.params.methodId as string,
    payload,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payout method updated successfully!",
    data: result,
  });
});

const deletePayoutMethod = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.deletePayoutMethod(
    req.user._id,
    modeFromQuery(req),
    req.params.methodId as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payout method deleted successfully!",
    data: result,
  });
});

const requestWithdrawal = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.requestWithdrawal(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Withdrawal requested successfully!",
    data: result,
  });
});

const getMyWithdrawals = catchAsync(async (req: Request, res: Response) => {
  const mode = modeFromQuery(req);
  const result = await WalletServices.getMyWithdrawals(req.user._id, mode, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, WithdrawalStatus, "status"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Withdrawals retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getMyCodSettlements = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.getMyCodSettlements(req.user._id, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, CodSettlementStatus, "status"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "COD settlements retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getMyTransactions = catchAsync(async (req: Request, res: Response) => {
  const mode = modeFromQuery(req);
  const result = await WalletServices.getMyTransactions(req.user._id, mode, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    type: enumQuery(req.query.type, TransactionType, "type"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Transactions retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const submitCodSettlement = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.submitCodSettlement(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "COD settlement submitted successfully!",
    data: result,
  });
});

const getAllWithdrawalsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.getAllWithdrawalsAdmin({
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, WithdrawalStatus, "status"),
    ownerMode: enumQuery(req.query.ownerMode, WalletMode, "ownerMode"),
    method: enumQuery(req.query.method, PayoutMethodType, "method"),
    search: queryString(req.query.search),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Withdrawals retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const processWithdrawal = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.processWithdrawal(
    req.user._id,
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Withdrawal ${req.body.status} successfully!`,
    data: result,
  });
});

const getAllCodSettlementsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.getAllCodSettlementsAdmin({
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, CodSettlementStatus, "status"),
    riderId: typeof req.query.riderId === "string" ? req.query.riderId : undefined,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "COD settlements retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const confirmCodSettlement = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletServices.confirmCodSettlement(
    req.user._id,
    req.params.id as string,
    req.body.status,
    req.body.rejectionReason,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `COD settlement ${req.body.status} successfully!`,
    data: result,
  });
});

export const WalletControllers = {
  getMyWallet,
  getMySummary,
  addPayoutMethod,
  updatePayoutMethod,
  deletePayoutMethod,
  requestWithdrawal,
  getMyWithdrawals,
  getMyTransactions,
  submitCodSettlement,
  getMyCodSettlements,
  getAllWithdrawalsAdmin,
  processWithdrawal,
  getAllCodSettlementsAdmin,
  confirmCodSettlement,
};

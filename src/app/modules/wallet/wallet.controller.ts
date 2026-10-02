import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { WalletMode } from "./wallet.interface";
import { WalletServices } from "./wallet.service";

const modeFromQuery = (req: Request) => {
  const mode = req.query.mode as WalletMode;
  if (!Object.values(WalletMode).includes(mode)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Query `mode` must be vendor or rider");
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

export const WalletControllers = {
  getMyWallet,
  addPayoutMethod,
  updatePayoutMethod,
  deletePayoutMethod,
};

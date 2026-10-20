import crypto from "crypto";
import { Request, Response } from "express";
import httpStatus from "http-status";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PaymentServices } from "./payment.service";
import { enumQuery } from "../../utils/queryParams";
import {
  DisputeStatus,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
} from "./payment.interface";

const initiatePayment = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.initiatePayment(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Payment initiated successfully!",
    data: result,
  });
});

const handleWebhook = catchAsync(async (req: Request, res: Response) => {
  const expected = configs.payment_webhook_secret;
  if (!expected) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, "Payment webhook is not configured");
  }

  const received = req.headers["x-webhook-secret"];
  // Constant-time comparison so the secret cannot be guessed byte by byte
  const isValid =
    typeof received === "string" &&
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));

  if (!isValid) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid webhook secret");
  }

  const result = await PaymentServices.handleWebhook(req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Webhook processed successfully!",
    data: result,
  });
});

const getMyPayments = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.getMyPayments(req.user._id, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    purpose: enumQuery(req.query.purpose, PaymentPurpose, "purpose"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const createDispute = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.createDispute(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Dispute submitted successfully!",
    data: result,
  });
});

const getMyDisputes = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.getMyDisputes(req.user._id, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, DisputeStatus, "status"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Disputes retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getAllPaymentsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.getAllPaymentsAdmin({
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, PaymentStatus, "status"),
    purpose: enumQuery(req.query.purpose, PaymentPurpose, "purpose"),
    method: enumQuery(req.query.method, PaymentMethod, "method"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const issueRefund = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.issueRefund(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Refund issued successfully!",
    data: result,
  });
});

const getAllRefundsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.getAllRefundsAdmin({
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, RefundStatus, "status"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Refunds retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getAllDisputesAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.getAllDisputesAdmin({
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, DisputeStatus, "status"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Disputes retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const resolveDispute = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.resolveDispute(
    req.user._id,
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Dispute ${req.body.status} successfully!`,
    data: result,
  });
});

const getMyPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.getMyPayment(req.user._id, String(req.params.id));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment retrieved successfully!",
    data: result,
  });
});

const devConfirmPayment = catchAsync(async (req: Request, res: Response) => {
  if (configs.node_env === "production") {
    throw new AppError(httpStatus.NOT_FOUND, "Route not found");
  }
  const result = await PaymentServices.devConfirmPayment(req.user._id, String(req.params.id), req.body.status);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment updated (development)",
    data: result,
  });
});

export const PaymentControllers = {
  initiatePayment,
  handleWebhook,
  getMyPayments,
  getMyPayment,
  devConfirmPayment,
  createDispute,
  getMyDisputes,
  getAllPaymentsAdmin,
  issueRefund,
  getAllRefundsAdmin,
  getAllDisputesAdmin,
  resolveDispute,
};

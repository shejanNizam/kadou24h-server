import crypto from "crypto";
import { Request, Response } from "express";
import httpStatus from "http-status";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PaymentServices } from "./payment.service";
import { RefundServices } from "./refund.service";
import { enumQuery } from "../../utils/queryParams";
import {
  DisputeStatus,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
} from "./payment.interface";

/** No gateway connected yet: the app may finish its own payments (see PAYMENT_MODE) */
const demoPayments = () => configs.payment_mode === "demo";
const withMode = (payment: { toObject?: () => object } & object) => ({
  ...(typeof payment.toObject === "function" ? payment.toObject() : payment),
  demo: demoPayments(),
});

const initiatePayment = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.initiatePayment(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Payment initiated successfully!",
    data: withMode(result),
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

/** An aggregator's webhook (its own format and signature) */
const handleGatewayWebhook = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentServices.handleGatewayWebhook(String(req.params.provider), {
    headers: req.headers,
    body: req.body,
    rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
  });
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Webhook received", data: result });
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

const processRefund = catchAsync(async (req: Request, res: Response) => {
  const result = await RefundServices.processRefund(req.user._id, req.params.id as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.status === "completed" ? "Refund approved" : "Refund rejected",
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
    data: withMode(result),
  });
});

const devConfirmPayment = catchAsync(async (req: Request, res: Response) => {
  // Real gateway connected: only the gateway confirms payments
  if (configs.node_env === "production" && !demoPayments()) {
    throw new AppError(httpStatus.NOT_FOUND, "Route not found");
  }
  const result = await PaymentServices.devConfirmPayment(req.user._id, String(req.params.id), req.body.status);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment updated (demo)",
    data: result,
  });
});

export const PaymentControllers = {
  initiatePayment,
  handleWebhook,
  handleGatewayWebhook,
  getMyPayments,
  getMyPayment,
  devConfirmPayment,
  createDispute,
  getMyDisputes,
  getAllPaymentsAdmin,
  issueRefund,
  processRefund,
  getAllRefundsAdmin,
  getAllDisputesAdmin,
  resolveDispute,
};

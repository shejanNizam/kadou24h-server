import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PaymentServices } from "./payment.service";

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
    purpose: req.query.purpose as any,
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
    status: req.query.status as any,
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
    status: req.query.status as any,
    purpose: req.query.purpose as any,
    method: req.query.method as any,
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
    status: req.query.status as any,
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
    status: req.query.status as any,
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

export const PaymentControllers = {
  initiatePayment,
  handleWebhook,
  getMyPayments,
  createDispute,
  getMyDisputes,
  getAllPaymentsAdmin,
  issueRefund,
  getAllRefundsAdmin,
  getAllDisputesAdmin,
  resolveDispute,
};

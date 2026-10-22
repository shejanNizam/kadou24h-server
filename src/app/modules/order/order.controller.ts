import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { OrderServices } from "./order.service";
import { enumQuery, numberQuery, queryString } from "../../utils/queryParams";
import { OrderStatus, PaymentMethod, PaymentStatus } from "./order.interface";

const checkoutSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.calculateCheckout(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Checkout summary calculated successfully",
    // The promo code document stays on the server (usage counters); the app gets result.coupon
    data: { ...result, appliedCoupon: undefined },
  });
});

const placeOrder = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.placeOrder(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Order placed successfully",
    data: result,
  });
});

const getMyOrders = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.getMyOrders(req.user._id, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "My orders retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getOrderDetails = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.getOrderDetails(
    req.params.id as string,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order details retrieved successfully",
    data: result,
  });
});

const cancelOrder = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.cancelOrder(
    req.params.id as string,
    req.user._id,
    req.body.reason,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order cancelled successfully",
    data: result,
  });
});

// Vendor Controllers
const getVendorSubOrders = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.getVendorSubOrders(
    req.user._id,
    req.query,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Vendor sub-orders retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getVendorSubOrderDetail = catchAsync(
  async (req: Request, res: Response) => {
    const result = await OrderServices.getVendorSubOrderDetail(
      req.user._id,
      req.params.id as string,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Vendor sub-order detail retrieved successfully",
      data: result,
    });
  },
);

const updateSubOrderStatus = catchAsync(async (req: Request, res: Response) => {
  const { status, note, estimatedDeliveryMinutes } = req.body;
  const result = await OrderServices.updateSubOrderStatus(
    req.user._id,
    req.params.id as string,
    status,
    note,
    estimatedDeliveryMinutes,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sub-order status updated successfully",
    data: result,
  });
});

const modifySubOrderItems = catchAsync(async (req: Request, res: Response) => {
  const { modifications, reason } = req.body;
  const result = await OrderServices.modifySubOrderItems(
    req.user._id,
    req.params.id as string,
    modifications,
    reason,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sub-order items modified successfully",
    data: result,
  });
});

const cancelVendorSubOrder = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.cancelVendorSubOrder(
    req.user._id,
    req.params.id as string,
    req.body.reason,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sub-order cancelled successfully",
    data: result,
  });
});

// Admin Controllers
const getAllOrdersAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.getAllOrdersAdmin({
    page: numberQuery(req.query.page),
    limit: numberQuery(req.query.limit),
    status: enumQuery(req.query.status, OrderStatus, "status"),
    paymentStatus: enumQuery(req.query.paymentStatus, PaymentStatus, "paymentStatus"),
    paymentMethod: enumQuery(req.query.paymentMethod, PaymentMethod, "paymentMethod"),
    customerId: queryString(req.query.customerId),
    search: queryString(req.query.search),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All orders retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getAdminOrderDetail = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.getOrderDetails(req.params.id as string, undefined, { admin: true });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin order detail retrieved successfully",
    data: result,
  });
});

const adminCancelSubOrder = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.adminCancelSubOrder(
    req.params.id as string,
    req.body.reason,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sub-order cancelled by admin successfully",
    data: result,
  });
});

const cancelStorePart = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderServices.cancelStorePart(req.params.id as string, req.params.subOrderId as string, req.user._id, req.body.reason);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "This store's part was cancelled",
    data: result,
  });
});

export const OrderControllers = {
  cancelStorePart,
  checkoutSummary,
  placeOrder,
  getMyOrders,
  getOrderDetails,
  cancelOrder,
  getVendorSubOrders,
  getVendorSubOrderDetail,
  updateSubOrderStatus,
  modifySubOrderItems,
  cancelVendorSubOrder,
  getAllOrdersAdmin,
  getAdminOrderDetail,
  adminCancelSubOrder,
};

import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { SubscriptionServices } from "./subscription.service";

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.createPlan(
    req.user._id,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Subscription plan created successfully!",
    data: result,
  });
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.updatePlan(
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Subscription plan updated successfully!",
    data: result,
  });
});

const getActivePlans = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.getActivePlans(
    req.query.audience as any,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Subscription plans retrieved successfully!",
    data: result,
  });
});

const subscribe = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.subscribe(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Subscribed successfully!",
    data: result,
  });
});

const getMySubscription = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.getMySubscription(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User subscription retrieved successfully!",
    data: result,
  });
});

export const SubscriptionControllers = {
  createPlan,
  updatePlan,
  getActivePlans,
  subscribe,
  getMySubscription,
};

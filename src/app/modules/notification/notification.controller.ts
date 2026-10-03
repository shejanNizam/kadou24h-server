import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { NotificationServices } from "./notification.service";

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const result = await NotificationServices.getMyNotifications(userId, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Notifications retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const id = req.params.id as string;
  const result = await NotificationServices.markAsRead(userId, id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Notification marked as read",
    data: result,
  });
});

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const mode = req.query.mode as string | undefined;
  const result = await NotificationServices.markAllAsRead(userId, mode);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "All notifications marked as read",
    data: result,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const mode = req.query.mode as string | undefined;
  const result = await NotificationServices.getUnreadCount(userId, mode);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Unread count retrieved",
    data: result,
  });
});

export const NotificationControllers = {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
};

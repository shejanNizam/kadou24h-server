import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { NotificationServices } from "./notification.service";

const sendTeamMessage = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationServices.sendTeamMessage(req.user._id, { userId: req.body.userId, title: req.body.title, body: req.body.message });
  sendResponse(res, { statusCode: 201, success: true, message: "Message sent", data: result });
});

const getTeamMessages = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationServices.getTeamMessages(String(req.params.userId));
  sendResponse(res, { statusCode: 200, success: true, message: "Team messages", data: result });
});

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

const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  await NotificationServices.deleteNotification(req.user._id, req.params.id as string);
  sendResponse(res, { statusCode: 200, success: true, message: "Notification deleted", data: null });
});

const deleteAllNotifications = catchAsync(async (req: Request, res: Response) => {
  const mode = req.query.mode as string | undefined;
  const result = await NotificationServices.deleteAllNotifications(req.user._id, mode);
  sendResponse(res, { statusCode: 200, success: true, message: "Notifications deleted", data: result });
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
  sendTeamMessage,
  getTeamMessages,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  getUnreadCount,
};

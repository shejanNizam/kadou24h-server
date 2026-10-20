import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AppMode } from "../user/user.interface";
import { ChatServices } from "./chat.service";

const startOrGetConversation = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const result = await ChatServices.startOrGetConversation(userId, req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Conversation ready",
    data: result,
  });
});

const getMyConversations = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const mode = (req.query.mode as string) || req.user.lastActiveMode || AppMode.customer;
  const result = await ChatServices.getMyConversations(userId, mode, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Conversations retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const mode = (req.query.mode as string) || req.user.lastActiveMode || AppMode.customer;
  const result = await ChatServices.getUnreadCount(req.user._id, mode);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Unread count retrieved successfully",
    data: result,
  });
});

const getConversationById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const id = req.params.id as string;
  const result = await ChatServices.getConversationById(userId, id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Conversation retrieved successfully",
    data: result,
  });
});

const getMessages = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const id = req.params.id as string;
  const result = await ChatServices.getMessages(userId, id, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Messages retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const senderId = req.user._id;
  const conversationId = req.params.id as string;
  const result = await ChatServices.sendMessage(senderId, conversationId, req.body);

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Message sent successfully",
    data: result,
  });
});

const markConversationAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const mode = (req.query.mode as string) || req.user.lastActiveMode;
  const conversationId = req.params.id as string;
  const result = await ChatServices.markConversationAsRead(userId, mode, conversationId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Conversation marked as read",
    data: result,
  });
});

const getModerationViolationsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatServices.getModerationViolationsAdmin(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Moderation violations retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const liftUserChatRestrictionAdmin = catchAsync(async (req: Request, res: Response) => {
  const userId = req.params.userId as string;
  const result = await ChatServices.liftUserChatRestrictionAdmin(userId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "User chat restriction lifted successfully",
    data: result,
  });
});

export const ChatControllers = {
  getUnreadCount,
  startOrGetConversation,
  getMyConversations,
  getConversationById,
  getMessages,
  sendMessage,
  markConversationAsRead,
  getModerationViolationsAdmin,
  liftUserChatRestrictionAdmin,
};

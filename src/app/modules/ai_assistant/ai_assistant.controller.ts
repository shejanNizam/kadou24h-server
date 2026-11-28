import { Request, Response } from "express";
import httpStatus from "http-status";
import { localeOf } from "../../i18n/locale";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AppMode } from "../user/user.interface";
import { AssistantServices } from "./ai_assistant.service";

const modeOf = (req: Request): AppMode => (req.body?.mode as AppMode) || (req.user.mode as AppMode) || AppMode.customer;

const getCurrent = catchAsync(async (req: Request, res: Response) => {
  const result = await AssistantServices.getCurrent(req.user._id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Assistant conversation retrieved", data: result });
});

const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const result = await AssistantServices.sendMessage(req.user._id, modeOf(req), localeOf(req), req.body.text);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Assistant answered", data: result });
});

const closeCurrent = catchAsync(async (req: Request, res: Response) => {
  await AssistantServices.closeCurrent(req.user._id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Assistant conversation closed", data: null });
});

const handOff = catchAsync(async (req: Request, res: Response) => {
  const result = await AssistantServices.handOff(req.user._id, modeOf(req), req.body.note);
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: "Sent to the support team", data: result });
});

const getConversationAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await AssistantServices.getConversationAdmin(req.params.id as string);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Assistant conversation retrieved", data: result });
});

const getUsageAdmin = catchAsync(async (_req: Request, res: Response) => {
  const result = await AssistantServices.getUsageAdmin();
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Assistant usage retrieved", data: result });
});

export const AssistantControllers = {
  getCurrent,
  sendMessage,
  closeCurrent,
  handOff,
  getConversationAdmin,
  getUsageAdmin,
};

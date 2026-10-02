import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { UserServices } from "./user.service";

// ── Self-service ──

const getMe = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.getMe(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile retrieved successfully!",
    data: result,
  });
});

const updateMe = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.updateMe(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile updated successfully!",
    data: result,
  });
});

const switchMode = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.switchMode(req.user._id, req.body.mode);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Switched to ${result.mode} mode`,
    data: result,
  });
});

const updateNotificationPrefs = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.updateNotificationPrefs(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification preferences updated!",
    data: result,
  });
});

const requestPhoneChange = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.requestPhoneChange(req.user._id, req.body.phone);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Verification code sent to the new phone number",
    data: result,
  });
});

const verifyPhoneChange = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.verifyPhoneChange(
    req.user._id,
    req.body.phone,
    req.body.otp,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Phone number verified successfully!",
    data: result,
  });
});

const deleteMe = catchAsync(async (req: Request, res: Response) => {
  await UserServices.deleteMe(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Account deleted successfully!",
    data: null,
  });
});

// ── Admin — app users ──

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.getAllUsers(req.query as unknown as Record<string, string>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getSingleUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.getSingleUser(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User retrieved successfully!",
    data: result,
  });
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.updateUserStatus(
    req.params.id as string,
    req.body,
    { _id: req.user._id, roles: req.user.roles },
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User status updated successfully!",
    data: result,
  });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
  await UserServices.deleteUser(req.params.id as string, {
    _id: req.user._id,
    roles: req.user.roles,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User deleted successfully!",
    data: null,
  });
});

// ── Admin — team members ──

const getTeamMembers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.getTeamMembers(req.query as unknown as Record<string, string>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Team members retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const createTeamMember = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.createTeamMember(req.body, req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Team member created successfully!",
    data: result,
  });
});

const updateTeamMember = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.updateTeamMember(
    req.params.id as string,
    req.body,
    { _id: req.user._id, roles: req.user.roles },
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Team member updated successfully!",
    data: result,
  });
});

export const UserControllers = {
  getMe,
  updateMe,
  switchMode,
  updateNotificationPrefs,
  requestPhoneChange,
  verifyPhoneChange,
  deleteMe,
  getAllUsers,
  getSingleUser,
  updateUserStatus,
  deleteUser,
  getTeamMembers,
  createTeamMember,
  updateTeamMember,
};

import { Request, Response } from "express";
import httpStatus from "http-status";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { setAuthCookie } from "../../utils/setCookie";
import { AuthServices } from "./auth.service";

const clearAuthCookies = (res: Response) => {
  const options = {
    httpOnly: true,
    secure: configs.node_env === "production",
    sameSite: (configs.node_env === "production" ? "none" : "lax") as "none" | "lax",
  };
  res.clearCookie("accessToken", options);
  res.clearCookie("refreshToken", options);
};

const register = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.register(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Account created. Enter the code we sent to verify your phone.",
    data: result,
  });
});

const verifyAccount = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.verifyAccount(req.body.phone, req.body.otp);
  setAuthCookie(res, result);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Account verified successfully!",
    data: result,
  });
});

const resendOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.resendOtp(req.body.identifier, req.body.purpose);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Verification code sent",
    data: result,
  });
});

const login = catchAsync(async (req: Request, res: Response) => {
  const identifier = (req.body.identifier || req.body.email || req.body.phone)?.trim();
  const result = await AuthServices.login(identifier, req.body.password);

  if ("requiresVerification" in result) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Please verify your phone number. We sent you a code.",
      data: result,
    });
  }

  setAuthCookie(res, result);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged in successfully!",
    data: result,
  });
});

const socialLogin = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.socialLogin(req.body);
  setAuthCookie(res, result);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged in successfully!",
    data: result,
  });
});

const getNewAccessToken = catchAsync(async (req: Request, res: Response) => {
  // Mobile apps send it in the body; the admin panel relies on the cookie
  const refreshToken = req.body?.refreshToken ?? req.cookies?.refreshToken;
  if (!refreshToken) {
    throw new AppError(httpStatus.BAD_REQUEST, "REFRESH_TOKEN_REQUIRED");
  }

  const result = await AuthServices.getNewAccessToken(refreshToken as string);
  setAuthCookie(res, result);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "New access token issued",
    data: result,
  });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.logout(req.body?.deviceToken);
  clearAuthCookies(res);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged out successfully!",
    data: null,
  });
});

const logoutAll = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.logoutAll(req.user._id);
  clearAuthCookies(res);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged out from all devices",
    data: null,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const tokens = await AuthServices.changePassword(
    req.user._id,
    req.body.oldPassword,
    req.body.newPassword,
  );
  setAuthCookie(res, tokens);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed. Other devices have been signed out.",
    data: tokens,
  });
});

const setPassword = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.setPassword(req.user._id, req.body.password);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password set successfully!",
    data: null,
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.forgotPassword(req.body.identifier);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: { expiresIn: result.expiresIn, resendIn: result.resendIn },
  });
});

const verifyResetOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.verifyResetOtp(req.body.identifier, req.body.otp);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Code verified. You can now set a new password.",
    data: result,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.resetPassword(req.user, req.body.newPassword);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset successfully! Please log in.",
    data: null,
  });
});

export const AuthControllers = {
  register,
  verifyAccount,
  resendOtp,
  login,
  socialLogin,
  getNewAccessToken,
  logout,
  logoutAll,
  changePassword,
  setPassword,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
};

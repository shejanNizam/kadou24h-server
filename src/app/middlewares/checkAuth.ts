import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { isLocale } from "../i18n/locale";
import { UserStatus } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { verifyToken } from "../utils/jwt";

/**
 * Authenticates the request and allows it when the user holds at least one of
 * `authRoles`. The user is re-read from the database so role changes,
 * suspensions and "log out everywhere" (tokenVersion) apply immediately.
 *
 * Sets `req.user = { _id, roles, mode }`, and `req.locale` to the user's saved
 * language when the request did not ask for one.
 */
export const checkAuth =
  (...authRoles: string[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const accessToken =
        req.headers.authorization?.split(" ")[1] ?? req.cookies?.accessToken;

      if (!accessToken) {
        throw new AppError(httpStatus.UNAUTHORIZED, "TOKEN_MISSING");
      }

      let verifiedToken: JwtPayload;
      try {
        verifiedToken = verifyToken(accessToken, configs.jwt_access_secret) as JwtPayload;
      } catch {
        throw new AppError(httpStatus.UNAUTHORIZED, "TOKEN_INVALID");
      }

      const user = await User.findById(verifiedToken._id)
        .select("roles status statusReason tokenVersion isDeleted isPhoneVerified isEmailVerified lastActiveMode language")
        .lean();

      if (user && !req.locale && isLocale(user.language)) {
        req.locale = user.language;
      }

      if (!user || user.isDeleted) {
        throw new AppError(httpStatus.UNAUTHORIZED, "ACCOUNT_NOT_FOUND");
      }
      if ((verifiedToken.tokenVersion ?? 0) !== user.tokenVersion) {
        throw new AppError(httpStatus.UNAUTHORIZED, "SESSION_EXPIRED");
      }
      if (!user.isPhoneVerified && !user.isEmailVerified) {
        throw new AppError(httpStatus.FORBIDDEN, "ACCOUNT_NOT_VERIFIED");
      }
      if (user.status === UserStatus.suspended || user.status === UserStatus.banned) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          user.status === UserStatus.banned ? "ACCOUNT_BANNED" : "ACCOUNT_SUSPENDED",
          { reason: user.statusReason || "none" },
        );
      }
      if (!user.roles.some((role) => authRoles.includes(role))) {
        throw new AppError(httpStatus.FORBIDDEN, "ROLE_NOT_ALLOWED");
      }

      req.user = {
        _id: user._id.toString(),
        roles: user.roles,
        mode: user.lastActiveMode,
      } as JwtPayload;
      next();
    } catch (error) {
      next(error);
    }
  };

/** Accepts only the short-lived token returned by /auth/verify-reset-otp. */
export const checkResetToken = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      throw new AppError(httpStatus.UNAUTHORIZED, "RESET_TOKEN_MISSING");
    }

    let decoded: JwtPayload;
    try {
      decoded = verifyToken(token, configs.jwt_reset_secret) as JwtPayload;
    } catch {
      throw new AppError(httpStatus.UNAUTHORIZED, "RESET_TOKEN_INVALID");
    }

    if (decoded.purpose !== "reset_password") {
      throw new AppError(httpStatus.UNAUTHORIZED, "RESET_TOKEN_INVALID");
    }

    req.user = decoded;
    next();
  } catch (error) {
    next(error);
  }
};

/** If a bearer token is present and valid, sets req.user without blocking unauthenticated requests. */
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const accessToken =
      req.headers.authorization?.split(" ")[1] ?? req.cookies?.accessToken;
    if (accessToken) {
      const verifiedToken = verifyToken(accessToken, configs.jwt_access_secret) as JwtPayload;
      if (verifiedToken && verifiedToken._id) {
        req.user = {
          _id: verifiedToken._id,
          roles: verifiedToken.roles,
          mode: verifiedToken.mode,
        } as JwtPayload;
      }
    }
  } catch {
    // Ignore invalid/expired token on optional auth
  }
  next();
};

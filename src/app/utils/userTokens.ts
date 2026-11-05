import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { IUser, UserStatus } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { generateToken, verifyToken } from "./jwt";

// The token carries only what is needed to find and validate the user.
// Roles are re-read from the database on every request (see checkAuth),
// so approving / suspending a role takes effect immediately.
const buildPayload = (user: Partial<IUser>) => ({
  _id: user._id?.toString(),
  roles: user.roles,
  tokenVersion: user.tokenVersion ?? 0,
});

export const createUserTokens = (user: Partial<IUser>) => {
  const jwtPayload = buildPayload(user);

  const accessToken = generateToken(
    jwtPayload,
    configs.jwt_access_secret,
    configs.jwt_access_expires,
  );

  const refreshToken = generateToken(
    jwtPayload,
    configs.jwt_refresh_secret,
    configs.jwt_refresh_expires,
  );

  return { accessToken, refreshToken };
};

export const createNewAccessTokenWithRefreshToken = async (
  refreshToken: string,
) => {
  let verifiedRefreshToken: JwtPayload;
  try {
    verifiedRefreshToken = verifyToken(
      refreshToken,
      configs.jwt_refresh_secret,
    ) as JwtPayload;
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, "REFRESH_TOKEN_INVALID");
  }

  const user = await User.findById(verifiedRefreshToken._id);

  if (!user || user.isDeleted) {
    throw new AppError(httpStatus.UNAUTHORIZED, "ACCOUNT_NOT_FOUND");
  }
  if (user.status === UserStatus.suspended || user.status === UserStatus.banned) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      user.status === UserStatus.banned ? "ACCOUNT_BANNED" : "ACCOUNT_SUSPENDED",
      { reason: user.statusReason || "none" },
    );
  }
  if ((verifiedRefreshToken.tokenVersion ?? 0) !== user.tokenVersion) {
    throw new AppError(httpStatus.UNAUTHORIZED, "SESSION_EXPIRED");
  }

  return generateToken(
    buildPayload(user),
    configs.jwt_access_secret,
    configs.jwt_access_expires,
  );
};

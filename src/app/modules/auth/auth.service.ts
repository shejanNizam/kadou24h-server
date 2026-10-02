import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { generateToken } from "../../utils/jwt";
import {
  createNewAccessTokenWithRefreshToken,
  createUserTokens,
} from "../../utils/userTokens";
import { OAuthProvider, verifyOAuthToken } from "../../utils/verifyOAuthToken";
import { AuthIdentity } from "../auth_identity/auth_identity.model";
import { DeviceToken } from "../device_token/device_token.model";
import { OtpPurpose } from "../otp/otp.interface";
import { OTPService } from "../otp/otp.service";
import { IUser, Language, UserRole, UserStatus } from "../user/user.interface";
import { User } from "../user/user.model";
import {
  generateReferralCode,
  identifierFilter,
  maskEmail,
  maskPhone,
  normalizeIdentifier,
  toPublicUser,
} from "../user/user.utils";

const hashPassword = (password: string) =>
  bcrypt.hash(password, Number(configs.bcrypt_salt_round));

const assertCanSignIn = (user: IUser) => {
  if (user.status === UserStatus.suspended || user.status === UserStatus.banned) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      user.statusReason
        ? `Your account is ${user.status}: ${user.statusReason}`
        : `Your account is ${user.status}`,
    );
  }
};

const signIn = async (user: IUser) => {
  user.lastLoginAt = new Date();
  await user.save();
  const tokens = createUserTokens(user);
  return { user: toPublicUser(user), ...tokens };
};

const sendAccountCode = (user: IUser, options?: { reuseRecent?: boolean }) =>
  OTPService.issueOtp(
    OtpPurpose.verify_account,
    user.phone as string,
    {
      name: user.name,
      language: user.language,
      phone: user.phone,
      email: user.email,
    },
    options,
  );

// ──────────────────────────────
// Sign up
// ──────────────────────────────

const register = async (payload: {
  name: string;
  phone: string;
  email?: string;
  password: string;
  language?: Language;
  referralCode?: string;
}) => {
  const existing = await User.findOne({ phone: payload.phone, isDeleted: false });
  if (existing?.isPhoneVerified) {
    throw new AppError(
      httpStatus.CONFLICT,
      "An account with this phone number already exists. Please log in.",
    );
  }

  if (payload.email) {
    const emailOwner = await User.exists({
      email: payload.email,
      isDeleted: false,
      ...(existing && { _id: { $ne: existing._id } }),
    });
    if (emailOwner) throw new AppError(httpStatus.CONFLICT, "Email is already in use");
  }

  let referredBy;
  if (payload.referralCode) {
    const referrer = await User.findOne({ referralCode: payload.referralCode, isDeleted: false });
    if (!referrer) throw new AppError(httpStatus.BAD_REQUEST, "Invalid referral code");
    referredBy = referrer._id;
  }

  const details = {
    name: payload.name,
    email: payload.email,
    password: await hashPassword(payload.password),
    language: payload.language ?? Language.fr,
    referredBy,
  };

  // An unverified signup can be retried with corrected details
  let user: IUser;
  if (existing) {
    existing.set(details);
    user = await existing.save();
  } else {
    user = await User.create({
      ...details,
      phone: payload.phone,
      roles: [UserRole.customer],
      referralCode: await generateReferralCode(),
    });
    await AuthIdentity.create({ userId: user._id, provider: "local", providerId: payload.phone });
  }

  // Double-tapping "Create Account" must not fail on the resend cooldown
  const otp = await sendAccountCode(user, { reuseRecent: true });
  return { phone: maskPhone(user.phone), email: maskEmail(user.email), ...otp };
};

const verifyAccount = async (phone: string, otp: string) => {
  const user = await User.findOne({ phone, isDeleted: false });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "Account not found");
  if (user.isPhoneVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Account is already verified. Please log in.");
  }

  await OTPService.verifyOtp(OtpPurpose.verify_account, phone, otp);

  user.isPhoneVerified = true;
  return signIn(user);
};

const resendOtp = async (identifier: string, purpose: OtpPurpose) => {
  if (purpose === OtpPurpose.reset_password) return forgotPassword(identifier);

  const user = await User.findOne(identifierFilter(identifier));
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "Account not found");
  if (user.isPhoneVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Account is already verified. Please log in.");
  }
  if (!user.phone) throw new AppError(httpStatus.BAD_REQUEST, "This account has no phone number");

  const otp = await sendAccountCode(user);
  return { phone: maskPhone(user.phone), email: maskEmail(user.email), ...otp };
};

// ──────────────────────────────
// Sign in
// ──────────────────────────────

const login = async (identifier: string, password: string) => {
  const user = await User.findOne(identifierFilter(identifier)).select("+password");
  if (!user) throw new AppError(httpStatus.UNAUTHORIZED, "Invalid phone/email or password");

  if (!user.password) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This account uses Google or Apple sign-in. Continue with it, or reset your password.",
    );
  }

  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid phone/email or password");
  }

  assertCanSignIn(user);

  // Signed up but never entered the code: send a fresh one, no tokens yet
  if (!user.isPhoneVerified && !user.isEmailVerified) {
    const otp = await sendAccountCode(user, { reuseRecent: true });
    return {
      requiresVerification: true,
      phone: maskPhone(user.phone),
      email: maskEmail(user.email),
      ...otp,
    };
  }

  return signIn(user);
};

const socialLogin = async (payload: {
  provider: OAuthProvider;
  idToken: string;
  name?: string;
  language?: Language;
}) => {
  const profile = await verifyOAuthToken(payload.provider, payload.idToken);

  const identity = await AuthIdentity.findOne({
    provider: profile.provider,
    providerId: profile.providerId,
  });

  let user = identity
    ? await User.findOne({ _id: identity.userId, isDeleted: false })
    : null;

  if (!user) {
    if (!profile.email || !profile.emailVerified) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Your ${profile.provider} account has no verified email. Please sign up with your phone number.`,
      );
    }

    // Same verified email → link to the existing account
    user = await User.findOne({ email: profile.email, isDeleted: false });

    if (!user) {
      user = await User.create({
        name: payload.name ?? profile.name ?? profile.email.split("@")[0],
        email: profile.email,
        isEmailVerified: true,
        avatar: profile.picture ? { url: profile.picture, publicId: "" } : undefined,
        roles: [UserRole.customer],
        language: payload.language ?? Language.fr,
        referralCode: await generateReferralCode(),
      });
    } else if (!user.isEmailVerified) {
      user.isEmailVerified = true;
    }

    await AuthIdentity.create({
      userId: user._id,
      provider: profile.provider,
      providerId: profile.providerId,
    });
  }

  assertCanSignIn(user);

  const session = await signIn(user);
  // The app must collect a phone (POST /user/me/phone/request) before checkout
  return { ...session, requiresPhone: !user.isPhoneVerified };
};

const getNewAccessToken = async (refreshToken: string) => {
  const accessToken = await createNewAccessTokenWithRefreshToken(refreshToken);
  return { accessToken };
};

const logout = async (deviceToken?: string) => {
  if (deviceToken) await DeviceToken.deleteOne({ token: deviceToken });
};

// Invalidates every access & refresh token issued so far
const logoutAll = async (userId: string) => {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
};

// ──────────────────────────────
// Passwords
// ──────────────────────────────

const changePassword = async (userId: string, oldPassword: string, newPassword: string) => {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  if (!user.password) {
    throw new AppError(httpStatus.BAD_REQUEST, "No password set yet. Use set-password instead.");
  }

  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) throw new AppError(httpStatus.UNAUTHORIZED, "Old password does not match");

  user.password = await hashPassword(newPassword);
  user.tokenVersion += 1; // signs out other devices
  await user.save();

  // Keep this device signed in
  return createUserTokens(user);
};

const ensureLocalIdentity = async (user: IUser) => {
  const providerId = user.phone ?? user.email;
  if (!providerId) return;
  await AuthIdentity.updateOne(
    { userId: user._id, provider: "local" },
    { $setOnInsert: { providerId } },
    { upsert: true },
  );
};

// For Google / Apple accounts that want a password as well
const setPassword = async (userId: string, password: string) => {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  if (user.password) {
    throw new AppError(httpStatus.BAD_REQUEST, "Password already set. Use change-password instead.");
  }

  user.password = await hashPassword(password);
  await user.save();
  await ensureLocalIdentity(user);
};

/** Always answers the same way, so it cannot be used to discover accounts. */
async function forgotPassword(identifier: string) {
  const target = normalizeIdentifier(identifier);
  const user = await User.findOne(identifierFilter(identifier));

  const response = {
    message: "If an account exists, a verification code has been sent.",
    expiresIn: 300,
    resendIn: 60,
  };

  if (!user || user.status === UserStatus.banned) return response;

  const otp = await OTPService.issueOtp(OtpPurpose.reset_password, target, {
    name: user.name,
    language: user.language,
    phone: user.phone,
    email: user.email,
  });
  return { ...response, ...otp };
}

const verifyResetOtp = async (identifier: string, otp: string) => {
  const target = normalizeIdentifier(identifier);
  const user = await User.findOne(identifierFilter(identifier));
  if (!user) throw new AppError(httpStatus.BAD_REQUEST, "Code expired or not found. Please request a new one.");

  await OTPService.verifyOtp(OtpPurpose.reset_password, target, otp);

  // tokenVersion makes the reset token single-use: resetting bumps it
  const resetToken = generateToken(
    { _id: String(user._id), purpose: "reset_password", tokenVersion: user.tokenVersion },
    configs.jwt_reset_secret,
    "10m",
  );
  return { resetToken, expiresIn: 600 };
};

const resetPassword = async (decodedToken: JwtPayload, newPassword: string) => {
  const user = await User.findOne({ _id: decodedToken._id, isDeleted: false });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  if (user.tokenVersion !== decodedToken.tokenVersion) {
    throw new AppError(httpStatus.UNAUTHORIZED, "This reset code was already used. Please start again.");
  }

  user.password = await hashPassword(newPassword);
  user.tokenVersion += 1; // signs out every device
  await user.save();
  await ensureLocalIdentity(user);
};

export const AuthServices = {
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

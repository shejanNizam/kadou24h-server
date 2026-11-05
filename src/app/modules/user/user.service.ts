import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { disconnectUser } from "../../../socket/socket";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { AuthIdentity } from "../auth_identity/auth_identity.model";
import { DeviceToken } from "../device_token/device_token.model";
import { OtpPurpose } from "../otp/otp.interface";
import { OTPService } from "../otp/otp.service";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { DeliveryStatus } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { OrderStatus, SubOrderStatus } from "../order/order.interface";
import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { Wallet } from "../wallet/wallet.model";
import {
  ADMIN_ROLES,
  AppMode,
  INotificationPrefs,
  IUser,
  IUserInitial,
  UserRole,
  UserStatus,
} from "./user.interface";
import { User } from "./user.model";
import { maskPhone, toPublicUser } from "./user.utils";

const findActiveUser = async (userId: string) => {
  const user = await User.findOne({ _id: userId, isDeleted: false });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
  return user;
};

const isAdminAccount = (user: Pick<IUser, "roles">) =>
  user.roles.some((r) => ADMIN_ROLES.includes(r));

/**
 * Soft-deletes an account and releases its phone / email so they can be
 * registered again. Sessions, logins and push tokens are revoked.
 */
const softDelete = async (user: IUser) => {
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedContact: { phone: user.phone, email: user.email },
      },
      $unset: { phone: 1, email: 1 },
      $inc: { tokenVersion: 1 },
    },
  );
  await Promise.all([
    AuthIdentity.deleteMany({ userId: user._id }),
    DeviceToken.deleteMany({ userId: user._id }),
  ]);
  disconnectUser(String(user._id), "account_deleted");
};

// ──────────────────────────────
// Self-service
// ──────────────────────────────

// Includes the vendor / rider application status so the app can show
// "Become a Vendor", "Pending approval" or the mode switch button.
const getMe = async (userId: string) => {
  const [user, vendor, rider] = await Promise.all([
    findActiveUser(userId),
    VendorProfile.findOne({ userId }).select("approvalStatus reviewNote").lean(),
    RiderProfile.findOne({ userId }).select("approvalStatus reviewNote partnerType").lean(),
  ]);
  return {
    ...toPublicUser(user),
    applications: {
      vendor: vendor && { status: vendor.approvalStatus, reviewNote: vendor.reviewNote },
      rider: rider && {
        status: rider.approvalStatus,
        reviewNote: rider.reviewNote,
        partnerType: rider.partnerType,
      },
    },
  };
};

const updateMe = async (
  userId: string,
  payload: Pick<Partial<IUserInitial>, "name" | "avatar" | "language" | "country">,
) => {
  const user = await User.findOneAndUpdate(
    { _id: userId, isDeleted: false },
    { $set: payload },
    { returnDocument: "after", runValidators: true },
  );
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
  return toPublicUser(user);
};

const switchMode = async (userId: string, mode: AppMode) => {
  const user = await findActiveUser(userId);

  // A role is only added after the admin approves the vendor / rider application
  if (!user.roles.includes(mode as unknown as UserRole)) {
    throw mode === AppMode.customer
      ? new AppError(httpStatus.FORBIDDEN, "MODE_CUSTOMER_NOT_ALLOWED")
      : new AppError(httpStatus.FORBIDDEN, "MODE_NOT_APPROVED", { mode });
  }

  user.lastActiveMode = mode;
  await user.save();
  return { mode: user.lastActiveMode };
};

const updateNotificationPrefs = async (
  userId: string,
  prefs: Partial<INotificationPrefs>,
) => {
  const $set = Object.fromEntries(
    Object.entries(prefs).map(([key, value]) => [`notificationPrefs.${key}`, value]),
  );
  const user = await User.findOneAndUpdate(
    { _id: userId, isDeleted: false },
    { $set },
    { returnDocument: "after" },
  );
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
  return user.notificationPrefs;
};

const assertPhoneAvailable = async (phone: string, userId?: string) => {
  const owner = await User.exists({
    phone,
    isDeleted: false,
    ...(userId && { _id: { $ne: userId } }),
  });
  if (owner) {
    throw new AppError(httpStatus.CONFLICT, "PHONE_TAKEN");
  }
};

// Also used by Google / Apple users to add their first phone number.
const requestPhoneChange = async (userId: string, phone: string) => {
  const user = await findActiveUser(userId);
  if (user.phone === phone && user.isPhoneVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "PHONE_UNCHANGED");
  }
  await assertPhoneAvailable(phone, userId);

  // SMS only — the code proves the user holds this SIM.
  const result = await OTPService.issueOtp(OtpPurpose.change_phone, `${userId}:${phone}`, {
    name: user.name,
    language: user.language,
    phone,
  });
  return { phone: maskPhone(phone), ...result };
};

const verifyPhoneChange = async (userId: string, phone: string, otp: string) => {
  await OTPService.verifyOtp(OtpPurpose.change_phone, `${userId}:${phone}`, otp);
  await assertPhoneAvailable(phone, userId);

  const user = await User.findOneAndUpdate(
    { _id: userId, isDeleted: false },
    { $set: { phone, isPhoneVerified: true } },
    { returnDocument: "after" },
  );
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");

  await AuthIdentity.updateOne({ userId, provider: "local" }, { providerId: phone });
  return toPublicUser(user);
};

/**
 * Self-deletion is refused while the account is still part of money or parcels
 * in motion — otherwise a rider could vanish with COD cash, or a buyer with an
 * order on the way. The message says what to finish first.
 */
const assertNothingPending = async (userId: string) => {
  const OPEN_SUB_ORDER = [SubOrderStatus.pending_payment, SubOrderStatus.new, SubOrderStatus.accepted, SubOrderStatus.preparing, SubOrderStatus.ready_for_pickup, SubOrderStatus.in_delivery];
  const OPEN_LEG = [DeliveryStatus.assigned, DeliveryStatus.accepted, DeliveryStatus.going_to_pickup, DeliveryStatus.picked_up, DeliveryStatus.in_transit];

  if (await Order.exists({ customerId: userId, status: OrderStatus.active })) {
    throw new AppError(httpStatus.CONFLICT, "DELETE_BLOCKED_ORDERS");
  }
  const [vendor, rider, wallets] = await Promise.all([
    VendorProfile.findOne({ userId }).select("_id").lean(),
    RiderProfile.findOne({ userId }).select("_id").lean(),
    Wallet.find({ ownerId: userId }).select("ownerMode heldBalance availableBalance cashOwed").lean(),
  ]);
  if (vendor && (await SubOrder.exists({ vendorId: vendor._id, status: { $in: OPEN_SUB_ORDER } }))) {
    throw new AppError(httpStatus.CONFLICT, "DELETE_BLOCKED_STORE_ORDERS");
  }
  if (rider && (await Delivery.exists({ riderId: rider._id, status: { $in: OPEN_LEG } }))) {
    throw new AppError(httpStatus.CONFLICT, "DELETE_BLOCKED_DELIVERIES");
  }
  if (wallets.some((w) => (w.cashOwed ?? 0) > 0)) {
    throw new AppError(httpStatus.CONFLICT, "DELETE_BLOCKED_CASH");
  }
  if (wallets.some((w) => (w.heldBalance ?? 0) > 0 || (w.availableBalance ?? 0) > 0)) {
    throw new AppError(httpStatus.CONFLICT, "DELETE_BLOCKED_WALLET");
  }
};

const deleteMe = async (userId: string) => {
  const user = await findActiveUser(userId);
  if (user.roles.includes(UserRole.super_admin)) {
    throw new AppError(httpStatus.FORBIDDEN, "SUPER_ADMIN_UNDELETABLE");
  }
  await assertNothingPending(userId);
  await softDelete(user);
};

// ──────────────────────────────
// Admin — app users
// ──────────────────────────────

const getAllUsers = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(
    User.find({ isDeleted: false, roles: { $nin: ADMIN_ROLES } }),
    query,
  );

  const users = await queryBuilder
    .search(["name", "email", "phone"])
    .filter()
    .sort()
    .paginate()
    .build();

  const meta = await queryBuilder.getMeta();
  return { data: users, meta };
};

const getSingleUser = async (id: string) => toPublicUser(await findActiveUser(id));

/** Guards shared by every admin action on another account. */
const assertCanManage = (target: IUser, actorId: string, actorRoles: UserRole[]) => {
  if (String(target._id) === actorId) {
    throw new AppError(httpStatus.FORBIDDEN, "SELF_ACTION_FORBIDDEN");
  }
  if (target.roles.includes(UserRole.super_admin)) {
    throw new AppError(httpStatus.FORBIDDEN, "SUPER_ADMIN_PROTECTED");
  }
  if (isAdminAccount(target) && !actorRoles.includes(UserRole.super_admin)) {
    throw new AppError(httpStatus.FORBIDDEN, "SUPER_ADMIN_ONLY");
  }
};

const updateUserStatus = async (
  id: string,
  payload: { status: UserStatus; reason?: string },
  actor: { _id: string; roles: UserRole[] },
) => {
  const user = await findActiveUser(id);
  assertCanManage(user, actor._id, actor.roles);

  const before = { status: user.status, statusReason: user.statusReason };
  const isLockout =
    payload.status === UserStatus.suspended || payload.status === UserStatus.banned;

  user.status = payload.status;
  user.statusReason = payload.reason;
  if (isLockout) user.tokenVersion += 1; // kicks the user out of every device
  await user.save();
  if (isLockout) disconnectUser(id, `account_${payload.status}`);

  await AuditLogServices.record({
    actorId: actor._id,
    action: `user.status.${payload.status}`,
    targetType: "user",
    targetId: id,
    before,
    after: { status: user.status, statusReason: user.statusReason },
  });

  return toPublicUser(user);
};

const deleteUser = async (id: string, actor: { _id: string; roles: UserRole[] }) => {
  const user = await findActiveUser(id);
  assertCanManage(user, actor._id, actor.roles);

  await softDelete(user);

  await AuditLogServices.record({
    actorId: actor._id,
    action: "user.delete",
    targetType: "user",
    targetId: id,
    before: { name: user.name, phone: user.phone, email: user.email, roles: user.roles },
  });
};

// ──────────────────────────────
// Admin — team members (Settings → Members & Access)
// ──────────────────────────────

const getTeamMembers = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(
    User.find({ isDeleted: false, roles: { $in: ADMIN_ROLES } }),
    query,
  );

  const members = await queryBuilder
    .search(["name", "email"])
    .filter()
    .sort()
    .paginate()
    .build();

  const meta = await queryBuilder.getMeta();
  return { data: members, meta };
};

const createTeamMember = async (
  payload: { name: string; email: string; phone?: string; password: string; role: UserRole },
  actorId: string,
) => {
  const emailTaken = await User.exists({ email: payload.email, isDeleted: false });
  if (emailTaken) throw new AppError(httpStatus.CONFLICT, "EMAIL_TAKEN");
  if (payload.phone) await assertPhoneAvailable(payload.phone);

  const member = await User.create({
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    password: await bcrypt.hash(payload.password, Number(configs.bcrypt_salt_round)),
    roles: [payload.role],
    isEmailVerified: true,
  });

  await AuthIdentity.create({ userId: member._id, provider: "local", providerId: payload.email });

  await AuditLogServices.record({
    actorId,
    action: "team.create",
    targetType: "user",
    targetId: String(member._id),
    after: { name: member.name, email: member.email, roles: member.roles },
  });

  return toPublicUser(member);
};

const updateTeamMember = async (
  id: string,
  payload: { role?: UserRole; status?: UserStatus },
  actor: { _id: string; roles: UserRole[] },
) => {
  const member = await findActiveUser(id);
  if (!isAdminAccount(member)) {
    throw new AppError(httpStatus.BAD_REQUEST, "NOT_TEAM_MEMBER");
  }
  assertCanManage(member, actor._id, actor.roles);

  const before = { roles: member.roles, status: member.status };

  if (payload.role) member.roles = [payload.role];
  if (payload.status) member.status = payload.status;
  member.tokenVersion += 1; // new permissions apply from the next login
  await member.save();
  disconnectUser(id, "permissions_changed");

  await AuditLogServices.record({
    actorId: actor._id,
    action: "team.update",
    targetType: "user",
    targetId: id,
    before,
    after: { roles: member.roles, status: member.status },
  });

  return toPublicUser(member);
};

export const UserServices = {
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

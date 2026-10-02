import { model, Schema } from "mongoose";
import { fileRefSchema, geoPointSchema } from "../../utils/commonSchemas";
import {
  AddressLabel,
  AppMode,
  IUser,
  IUserAddress,
  Language,
  MAX_ADDRESSES,
  UserRole,
  UserStatus,
} from "./user.interface";

const addressSchema = new Schema<IUserAddress>(
  {
    label: { type: String, enum: Object.values(AddressLabel), default: AddressLabel.home },
    customLabel: { type: String, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    region: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    commune: { type: String, trim: true },
    neighborhood: { type: String, trim: true },
    landmark: { type: String, trim: true },
    directions: { type: String, trim: true },
    location: { type: geoPointSchema, required: true },
    placePhoto: { type: fileRefSchema },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const notificationPrefsSchema = new Schema(
  {
    orderUpdates: { type: Boolean, default: true },
    messages: { type: Boolean, default: true },
    deliveryUpdates: { type: Boolean, default: true },
    offers: { type: Boolean, default: true },
    jobPosts: { type: Boolean, default: true },
    accountAlerts: { type: Boolean, default: true },
  },
  { _id: false },
);

const moderationSchema = new Schema(
  {
    violationCount: { type: Number, default: 0 },
    lastViolationAt: { type: Date },
    chatRestrictedUntil: { type: Date },
  },
  { _id: false },
);

export const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    password: { type: String, select: false },
    avatar: {
      url: { type: String },
      publicId: { type: String },
    },
    roles: {
      type: [String],
      enum: Object.values(UserRole),
      default: [UserRole.customer],
    },
    lastActiveMode: {
      type: String,
      enum: Object.values(AppMode),
      default: AppMode.customer,
    },
    isPhoneVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    language: {
      type: String,
      enum: Object.values(Language),
      default: Language.fr,
    },
    country: { type: String, default: "GN" },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.active,
    },
    statusReason: { type: String },
    tokenVersion: { type: Number, default: 0 },
    notificationPrefs: { type: notificationPrefsSchema, default: () => ({}) },
    moderation: { type: moderationSchema, default: () => ({}) },
    referralCode: { type: String },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    blockedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    addresses: {
      type: [addressSchema],
      default: [],
      validate: {
        validator: (v: unknown[]) => v.length <= MAX_ADDRESSES,
        message: `You can save up to ${MAX_ADDRESSES} addresses`,
      },
    },
    lastLoginAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    // Phone / email are released on account deletion so they can be reused;
    // the original values are kept here for audits.
    deletedContact: {
      type: { phone: String, email: String },
      select: false,
      _id: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ referralCode: 1 }, { unique: true, sparse: true });
userSchema.index({ roles: 1, status: 1 });

export const User = model<IUser>("User", userSchema);

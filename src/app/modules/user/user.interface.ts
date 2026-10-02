import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

// App roles are granted to end users; admin roles are only for the admin panel.
// A user never holds both kinds at once.
export enum UserRole {
  customer = "customer",
  vendor = "vendor",
  rider = "rider",
  staff = "staff",
  admin = "admin",
  super_admin = "super_admin",
}

export const APP_ROLES = [UserRole.customer, UserRole.vendor, UserRole.rider];
export const ADMIN_ROLES = [UserRole.staff, UserRole.admin, UserRole.super_admin];
export const ALL_ROLES = Object.values(UserRole);

// The interface the mobile app is currently showing
export enum AppMode {
  customer = "customer",
  vendor = "vendor",
  rider = "rider",
}

// Account-wide status. Role-level status lives on vendor / rider profiles.
export enum UserStatus {
  active = "active",
  inactive = "inactive",
  suspended = "suspended",
  banned = "banned",
}

export enum Language {
  fr = "fr",
  en = "en",
}

export interface IAvatar {
  url: string;
  publicId: string;
}

export interface INotificationPrefs {
  orderUpdates: boolean;
  messages: boolean;
  deliveryUpdates: boolean;
  offers: boolean;
  jobPosts: boolean;
  accountAlerts: boolean;
}

export interface IModeration {
  violationCount: number;
  lastViolationAt?: Date;
  chatRestrictedUntil?: Date;
}

export enum AddressLabel {
  home = "home",
  office = "office",
  other = "other",
}

// Built for Guinea: no formal street addresses, so pin + photo + landmark matter most
export interface IUserAddress {
  _id?: Types.ObjectId;
  label: AddressLabel;
  customLabel?: string;
  fullName: string;
  phone: string;
  region?: string;
  city: string;
  commune?: string;
  neighborhood?: string;
  landmark?: string;
  directions?: string;
  location: IGeoPoint;
  placePhoto?: IFileRef;
  isDefault: boolean;
}

export const MAX_ADDRESSES = 10;

export interface IUserInitial {
  _id?: Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  password?: string;
  avatar?: IAvatar;
  roles: UserRole[];
  lastActiveMode: AppMode;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  language: Language;
  country?: string;
  status: UserStatus;
  statusReason?: string;
  tokenVersion: number;
  notificationPrefs?: INotificationPrefs;
  moderation?: IModeration;
  referralCode?: string;
  referredBy?: Types.ObjectId;
  blockedUserIds?: Types.ObjectId[];
  addresses?: Types.DocumentArray<IUserAddress & Document>;
  lastLoginAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  deletedContact?: { phone?: string; email?: string };
}

export type IUser = IUserInitial & Document;

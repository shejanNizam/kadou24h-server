import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";
import { IReviewable, IVerificationDocument } from "../profile_common/profile.common";

export enum VendorDocumentType {
  business_license = "business_license",
  national_id = "national_id",
}

export enum WeekDay {
  mon = "mon",
  tue = "tue",
  wed = "wed",
  thu = "thu",
  fri = "fri",
  sat = "sat",
  sun = "sun",
}

export interface IStoreAddress {
  text?: string;
  city?: string;
  country: string;
  location?: IGeoPoint;
}

export interface IStoreAvailability {
  enabled: boolean;
  days: WeekDay[];
  openTime: string; // "11:00"
  closeTime: string; // "21:00"
}

export interface IVendorStats {
  ratingAvg: number;
  ratingCount: number;
  totalOrders: number;
  totalProducts: number;
  totalRevenue: number;
}

export interface IVendorProfileInitial extends Omit<IReviewable, "_id"> {
  userId: Types.ObjectId;
  isPlatformStore: boolean; // the admin's own store
  storeName?: string;
  logo?: IFileRef;
  businessCategoryId?: Types.ObjectId;
  marketName?: string;
  businessPhone?: string;
  businessEmail?: string;
  address: IStoreAddress;
  documents: Types.DocumentArray<IVerificationDocument & Document>;
  isOpen: boolean;
  availability: IStoreAvailability;
  stats: IVendorStats;
}

export type IVendorProfile = IVendorProfileInitial & Document;

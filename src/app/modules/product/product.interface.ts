import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

export enum ProductApprovalStatus {
  pending = "pending",
  approved = "approved",
  rejected = "rejected",
}

export enum ProductTag {
  popular = "popular",
  new = "new",
  bestseller = "bestseller",
}

export interface IProductInitial {
  vendorId: Types.ObjectId;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  price: number; // in GNF
  discountPrice?: number; // in GNF, must be < price
  images: IFileRef[];
  features?: string[]; // tag chips on product page
  inTheBox?: string[];
  tags?: string[]; // popular | new | bestseller
  stockQty: number; // 0 = Out of Stock
  minStockAlert: number;
  prepTimeMinutes?: number;
  isAvailable: boolean; // vendor toggle "Available for sale"
  approvalStatus: ProductApprovalStatus;
  adminReviewNote?: string;
  vendorLocation?: IGeoPoint; // GeoJSON Point copied from vendor for 2dsphere distance filtering
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  createdBy: Types.ObjectId; // User._id
  isDeleted: boolean;
  deletedAt?: Date;
}

export type IProduct = IProductInitial & Document;

export interface IProductFilterQuery {
  searchTerm?: string;
  category?: string;
  subcategory?: string;
  vendorId?: string;
  minPrice?: string;
  maxPrice?: string;
  inStock?: string; // 'true' | 'false'
  rating?: string; // minimum rating (e.g. 4.0)
  tags?: string; // comma separated
  lat?: string;
  lng?: string;
  maxDistance?: string; // distance in km
  sort?: string; // 'price_asc' | 'price_desc' | 'rating' | 'popular' | 'newest'
  page?: string;
  limit?: string;
}

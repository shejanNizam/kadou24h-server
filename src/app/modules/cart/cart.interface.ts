import { Document, Types } from "mongoose";

export interface ICartItem {
  _id?: Types.ObjectId;
  productId: Types.ObjectId;
  vendorId: Types.ObjectId;
  qty: number;
}

export interface ICartInitial {
  userId: Types.ObjectId;
  items: ICartItem[];
}

export type ICart = ICartInitial & Document;

export interface ICartItemPopulated {
  _id?: string;
  productId: string;
  name: string;
  slug: string;
  image?: string;
  price: number;
  discountPrice?: number;
  effectivePrice: number;
  stockQty: number;
  isAvailable: boolean;
  prepTimeMinutes?: number;
  vendorId: string;
  qty: number;
  lineTotal: number;
}

export interface IVendorCartGroup {
  vendorId: string;
  storeName: string;
  logo?: string;
  isOpen: boolean;
  city?: string;
  location?: [number, number];
  items: ICartItemPopulated[];
  subtotal: number;
  itemCount: number;
}

export interface ICartResponse {
  _id: string;
  userId: string;
  totalItems: number;
  subtotal: number;
  groupedByVendor: IVendorCartGroup[];
  unavailableItems: ICartItemPopulated[];
}

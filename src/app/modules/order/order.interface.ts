import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

export enum DeliveryType {
  local = "local",
  intercity = "intercity",
  station_pickup = "station_pickup",
}

export enum PaymentMethod {
  cod = "cod",
  orange_money = "orange_money",
  mobile_money = "mobile_money",
  card = "card",
}

export enum PaymentStatus {
  unpaid = "unpaid",
  paid = "paid",
  partially_refunded = "partially_refunded",
  refunded = "refunded",
}

export enum OrderStatus {
  active = "active",
  completed = "completed",
  cancelled = "cancelled",
  partially_cancelled = "partially_cancelled",
}

export enum SubOrderStatus {
  new = "new",
  accepted = "accepted",
  preparing = "preparing",
  ready_for_pickup = "ready_for_pickup",
  in_delivery = "in_delivery",
  delivered = "delivered",
  cancelled = "cancelled",
}

export enum SettlementStatus {
  held = "held",
  released = "released",
  refunded = "refunded",
}

export interface IAddressSnapshot {
  fullName: string;
  phone: string;
  city: string;
  commune?: string;
  neighborhood?: string;
  landmark?: string;
  directions?: string;
  location: IGeoPoint;
  placePhoto?: IFileRef;
}

export interface ISubOrderItem {
  _id?: Types.ObjectId;
  productId: Types.ObjectId;
  name: string;
  image?: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  removed: boolean;
}

export interface ISubOrderTimelineEntry {
  _id?: Types.ObjectId;
  status: string;
  note?: string;
  byUserId?: Types.ObjectId;
  at: Date;
}

export interface ISubOrderModification {
  _id?: Types.ObjectId;
  removedItems: {
    productId: Types.ObjectId;
    name: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  oldTotal: number;
  newTotal: number;
  refundAmount: number;
  byUserId: Types.ObjectId;
  at: Date;
}

export interface ISubOrderCancellation {
  by: "customer" | "vendor" | "admin";
  reason: string;
  at: Date;
}

export interface ISubOrderInitial {
  orderId: Types.ObjectId;
  subOrderNumber: string;
  customerId: Types.ObjectId;
  vendorId: Types.ObjectId;
  currentLegId?: Types.ObjectId;
  currentRiderId?: Types.ObjectId;
  items: ISubOrderItem[];
  timeline: ISubOrderTimelineEntry[];
  modifications: ISubOrderModification[];
  subtotal: number;
  deliveryFee: number;
  discountShare: number;
  total: number;
  commissionRate: number;
  commissionAmount: number;
  vendorEarning: number;
  status: SubOrderStatus;
  estimatedDeliveryAt?: Date;
  cancellation?: ISubOrderCancellation;
  codAmountToCollect?: number;
  codCollectedBy?: Types.ObjectId;
  codCollectedAt?: Date;
  settlement: SettlementStatus;
  releasedAt?: Date;
}

export type ISubOrder = ISubOrderInitial & Document;

export interface IOrderInitial {
  orderNumber: string;
  customerId: Types.ObjectId;
  addressSnapshot: IAddressSnapshot;
  deliveryType: DeliveryType;
  destinationStationId?: Types.ObjectId;
  specialInstructions?: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: number;
  deliveryFee: number;
  taxAmount: number;
  platformFee: number;
  discount: number;
  total: number;
  couponCode?: string;
  status: OrderStatus;
  placedAt: Date;
}

export type IOrder = IOrderInitial & Document;

export interface ICheckoutItemInput {
  productId: string;
  qty: number;
}

export interface ICheckoutSummaryInput {
  items?: ICheckoutItemInput[];
  addressId?: string;
  addressSnapshot?: IAddressSnapshot;
  deliveryType: DeliveryType;
  destinationStationId?: string;
  specialInstructions?: string;
  paymentMethod: PaymentMethod;
}

export interface IPlaceOrderInput extends ICheckoutSummaryInput {
  // same structure, used to convert preview into actual order
}

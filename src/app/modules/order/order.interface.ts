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
  // Online payment not confirmed yet: only the customer sees it (stock is reserved);
  // it becomes "new" for the store once paid, or is cancelled after the payment window
  pending_payment = "pending_payment",
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
  // COD delivered: the rider holds the cash; the vendor is paid once the
  // rider's cash settlements cover this sub-order (FIFO)
  awaiting_cod = "awaiting_cod",
  released = "released",
  refunded = "refunded",
  cancelled = "cancelled",
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
  /** Text a person wrote (a reason, the store's note). System steps have none: `status` and `params` say it */
  note?: string;
  /** Facts shown with the step, e.g. { leg: 2, place: "Gare de Kindia" } or { by: "customer" } */
  params?: Record<string, string | number>;
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

/** Why Kadou24h cancelled it by itself (the apps word it in the reader's language) */
export type AutoCancelCode = "payment_expired" | "not_accepted";

export interface ISubOrderCancellation {
  by: "customer" | "vendor" | "admin" | "system";
  /** Set when by = system */
  code?: AutoCancelCode;
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
  /** Another city: the fare shared moto → bus → moto, fixed at checkout (client, 2026-11-25) */
  legFees?: { firstMile: number; lineHaul: number; lastMile: number };
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
  codRemittedAmount?: number; // part of codAmountToCollect the rider has handed over
  codSettledAt?: Date;
  settlement: SettlementStatus;
  releasedAt?: Date;
  deliveredAt?: Date; // final leg handed over (earnings summary buckets by this)
  /** When the store got it (status new): it must accept within settings.orders.acceptMinutes */
  awaitingSince?: Date;
  /** The "accept it soon" reminder went to the store */
  acceptReminderAt?: Date;
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
  /** Online orders: pay before this, or the order is cancelled and the stock released. */
  paymentDueAt?: Date;
  /**
   * Cash on delivery (client, 2026-10-23): the service fee, tax and delivery fees are paid
   * online first, so Kadou24h and the riders are covered; the riders collect only the
   * products in cash. Absent on older COD orders (everything was paid in cash).
   */
  upfrontAmount?: number;
  /** The customer deleted it from their history: hidden for them only, kept for everyone else */
  hiddenByCustomerAt?: Date;
  /** COD: when those fees were paid (the order then reached the stores) */
  feesPaidAt?: Date;
}

export type IOrder = IOrderInitial & Document;

export interface ICheckoutItemInput {
  productId: string;
  qty: number;
}

// Address typed in at checkout (location as { lat, lng }, like every API input)
export interface IAddressSnapshotInput extends Omit<IAddressSnapshot, "location"> {
  location: { lat: number; lng: number };
}

export interface ICheckoutSummaryInput {
  items?: ICheckoutItemInput[];
  addressId?: string;
  addressSnapshot?: IAddressSnapshotInput;
  deliveryType: DeliveryType;
  destinationStationId?: string;
  specialInstructions?: string;
  paymentMethod: PaymentMethod;
  /** Promo code typed at checkout */
  couponCode?: string;
}

export interface IPlaceOrderInput extends ICheckoutSummaryInput {
  // same structure, used to convert preview into actual order
}

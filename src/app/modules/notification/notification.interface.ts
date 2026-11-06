import { Document, Types } from "mongoose";

export enum NotificationType {
  order_placed = "order_placed",
  order_accepted = "order_accepted",
  rider_on_the_way = "rider_on_the_way",
  order_delivered = "order_delivered",
  order_cancelled = "order_cancelled",
  feedback_request = "feedback_request",
  new_message = "new_message",
  special_offer = "special_offer",
  new_delivery_assigned = "new_delivery_assigned",
  ready_for_pickup = "ready_for_pickup",
  collect_payment = "collect_payment",
  earnings_updated = "earnings_updated",
  withdrawal_update = "withdrawal_update",
  refund_update = "refund_update",
  application_update = "application_update",
  // The Kadou24h team removed or restored a job offer (to its poster)
  job_update = "job_update",
  booking_update = "booking_update",
  ride_update = "ride_update",
  profile_approved = "profile_approved",
  moderation_warning = "moderation_warning",
  account_suspended = "account_suspended",
  system_alert = "system_alert",
  // Written by the Kadou24h team to one user (dashboard), shown with a "Kadou24h Team" badge
  team_message = "team_message",
}

export interface ILocalizedMessage {
  fr: string;
  en: string;
}

export interface INotificationInitial {
  userId: Types.ObjectId;
  mode?: string; // customer | vendor | rider | admin
  type: NotificationType;
  title: ILocalizedMessage;
  body: ILocalizedMessage;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type INotification = INotificationInitial & Document;

import { Document, Types } from "mongoose";
import { AppMode } from "../user/user.interface";

export enum TicketUrgency {
  low = "low",
  medium = "medium",
  high = "high",
  critical = "critical",
}

export enum TicketStatus {
  open = "open",
  in_progress = "in_progress",
  resolved = "resolved",
  closed = "closed",
}

export enum TicketType {
  order_issue = "order_issue",
  account_access = "account_access",
  payment_dispute = "payment_dispute",
  app_bug = "app_bug",
  rider_conduct = "rider_conduct",
  vendor_inquiry = "vendor_inquiry",
  general = "general",
  other = "other",
}

export interface ISupportTicketInitial {
  ticketNumber: string;
  userId: Types.ObjectId;
  userMode: AppMode;
  type: TicketType;
  subject?: string;
  urgency: TicketUrgency;
  description: string;
  attachments?: string[];
  /** Sent from the help assistant: the team reads that conversation */
  assistantConversationId?: Types.ObjectId;
  status: TicketStatus;
  assignedTo?: Types.ObjectId;
  resolution?: string;
  resolvedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ISupportTicket = ISupportTicketInitial & Document;

import { model, Schema } from "mongoose";
import { AppMode } from "../user/user.interface";
import {
  ISupportTicket,
  TicketStatus,
  TicketType,
  TicketUrgency,
} from "./support_ticket.interface";

export const supportTicketSchema = new Schema<ISupportTicket>(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userMode: {
      type: String,
      enum: Object.values(AppMode),
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(TicketType),
      required: true,
    },
    subject: {
      type: String,
      trim: true,
    },
    urgency: {
      type: String,
      enum: Object.values(TicketUrgency),
      default: TicketUrgency.medium,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(TicketStatus),
      default: TicketStatus.open,
      required: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    resolution: {
      type: String,
      trim: true,
    },
    resolvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

supportTicketSchema.index({ status: 1, urgency: 1 });
supportTicketSchema.index({ createdAt: -1 });

export const SupportTicket = model<ISupportTicket>("SupportTicket", supportTicketSchema);

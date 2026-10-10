import { Types } from "mongoose";
import { emitToUser } from "../../../socket/socket";
import AppError from "../../errorHelpers/AppError";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { CounterServices } from "../counter/counter.service";
import { NotificationType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
import { AppMode } from "../user/user.interface";
import { User } from "../user/user.model";
import {
  ISupportTicket,
  TicketStatus,
  TicketType,
  TicketUrgency,
} from "./support_ticket.interface";
import { SupportTicket } from "./support_ticket.model";
import { containsRegex } from "../../utils/queryParams";

interface ICreateTicketPayload {
  type: TicketType;
  userMode?: AppMode;
  subject?: string;
  urgency?: TicketUrgency;
  description: string;
  attachments?: string[];
}

const createTicket = async (
  userId: string,
  userMode: AppMode,
  payload: ICreateTicketPayload,
): Promise<ISupportTicket> => {
  const user = await User.findById(userId);
  if (!user || user.isDeleted) {
    throw new AppError(404, "User not found");
  }

  const effectiveMode = payload.userMode || userMode || user.lastActiveMode || AppMode.customer;
  const ticketNumber = await CounterServices.nextCode("ticket");

  const ticket = await SupportTicket.create({
    ticketNumber,
    userId: new Types.ObjectId(userId),
    userMode: effectiveMode,
    type: payload.type,
    subject: payload.subject || `Support Ticket ${ticketNumber}`,
    urgency: payload.urgency || TicketUrgency.medium,
    description: payload.description,
    attachments: payload.attachments || [],
    status: TicketStatus.open,
  });

  // Notify user that ticket was created
  NotificationServices.createNotification({
    userId: user._id,
    mode: effectiveMode,
    type: NotificationType.system_alert,
    title: {
      fr: `Ticket ${ticketNumber} créé`,
      en: `Ticket ${ticketNumber} created`,
    },
    body: {
      fr: `Votre demande d'assistance a été enregistrée. Notre équipe vous répondra dans les plus brefs délais.`,
      en: `Your support request has been logged. Our team will get back to you shortly.`,
    },
    data: { ticketId: ticket._id.toString(), ticketNumber },
  }).catch(() => {
    // async silent catch
  });

  return ticket;
};

const getMyTickets = async (
  userId: string,
  query: { status?: string; page?: number; limit?: number },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
  };
  if (query.status) {
    filter.status = query.status;
  }

  const [data, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const getTicketById = async (
  userId: string,
  ticketId: string,
  isAdmin: boolean,
): Promise<ISupportTicket> => {
  const ticket = await SupportTicket.findById(ticketId)
    .populate("userId", "name phone email avatar roles")
    .populate("assignedTo", "name email");

  if (!ticket) {
    throw new AppError(404, "Support ticket not found");
  }

  if (!isAdmin && ticket.userId._id?.toString() !== userId.toString() && ticket.userId.toString() !== userId.toString()) {
    throw new AppError(403, "You do not have permission to view this ticket");
  }

  return ticket;
};

const getAllTicketsAdmin = async (query: {
  status?: string;
  urgency?: string;
  userMode?: string;
  type?: string;
  search?: string;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.urgency) filter.urgency = query.urgency;
  if (query.userMode) filter.userMode = query.userMode;
  if (query.type) filter.type = query.type;
  if (query.search) {
    filter.$or = [
      { ticketNumber: containsRegex(query.search) },
      { subject: containsRegex(query.search) },
      { description: containsRegex(query.search) },
    ];
  }

  const [data, total] = await Promise.all([
    SupportTicket.find(filter)
      .populate("userId", "name phone email avatar roles lastActiveMode")
      .populate("assignedTo", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const assignTicketAdmin = async (
  adminId: string,
  ticketId: string,
  assignedTo: string,
): Promise<ISupportTicket> => {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    throw new AppError(404, "Support ticket not found");
  }

  const staffUser = await User.findById(assignedTo);
  if (!staffUser) {
    throw new AppError(404, "Assigned staff member not found");
  }

  const before = { assignedTo: ticket.assignedTo };
  ticket.assignedTo = new Types.ObjectId(assignedTo);
  if (ticket.status === TicketStatus.open) {
    ticket.status = TicketStatus.in_progress;
  }
  await ticket.save();

  await AuditLogServices.record({
    actorId: adminId,
    action: "support_ticket.assign",
    targetType: "support_ticket",
    targetId: ticket._id.toString(),
    before,
    after: { assignedTo: ticket.assignedTo, status: ticket.status },
  });

  return ticket;
};

const updateTicketStatusAdmin = async (
  adminId: string,
  ticketId: string,
  payload: { status: TicketStatus; resolution?: string },
): Promise<ISupportTicket> => {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) {
    throw new AppError(404, "Support ticket not found");
  }

  const before = { status: ticket.status, resolution: ticket.resolution };
  ticket.status = payload.status;
  if (payload.resolution) {
    ticket.resolution = payload.resolution;
  }
  if (payload.status === TicketStatus.resolved || payload.status === TicketStatus.closed) {
    ticket.resolvedAt = new Date();
  }

  await ticket.save();

  await AuditLogServices.record({
    actorId: adminId,
    action: "support_ticket.status_change",
    targetType: "support_ticket",
    targetId: ticket._id.toString(),
    before,
    after: { status: ticket.status, resolution: ticket.resolution },
  });

  // Real-time socket event & push notification to ticket owner
  emitToUser(ticket.userId.toString(), "ticket_update", {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    resolution: ticket.resolution,
  });

  NotificationServices.createNotification({
    userId: ticket.userId,
    mode: ticket.userMode,
    type: NotificationType.system_alert,
    title: {
      fr: `Ticket ${ticket.ticketNumber} mis à jour`,
      en: `Ticket ${ticket.ticketNumber} updated`,
    },
    body: {
      fr: `Statut du ticket: ${ticket.status}. ${ticket.resolution ? `Résolution: ${ticket.resolution}` : ""}`,
      en: `Ticket status: ${ticket.status}. ${ticket.resolution ? `Resolution: ${ticket.resolution}` : ""}`,
    },
    data: {
      ticketId: ticket._id.toString(),
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
    },
  }).catch(() => {
    // async silent catch
  });

  return ticket;
};

export const SupportTicketServices = {
  createTicket,
  getMyTickets,
  getTicketById,
  getAllTicketsAdmin,
  assignTicketAdmin,
  updateTicketStatusAdmin,
};

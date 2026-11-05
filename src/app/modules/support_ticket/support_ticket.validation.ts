import { z } from "zod";
import { AppMode } from "../user/user.interface";
import { TicketStatus, TicketType, TicketUrgency } from "./support_ticket.interface";

const createTicketZodSchema = z.object({
  body: z.object({
    type: z.nativeEnum(TicketType),
    userMode: z.nativeEnum(AppMode).optional(),
    subject: z.string().optional(),
    urgency: z.nativeEnum(TicketUrgency).default(TicketUrgency.medium),
    description: z.string().min(5, "TEXT_TOO_SHORT"),
    attachments: z.array(z.string().url()).optional(),
  }),
});

const updateTicketStatusZodSchema = z.object({
  body: z.object({
    status: z.nativeEnum(TicketStatus),
    resolution: z.string().optional(),
  }),
});

const assignTicketZodSchema = z.object({
  body: z.object({
    assignedTo: z.string().min(1, "FIELD_REQUIRED"),
  }),
});

export const SupportTicketValidations = {
  createTicketZodSchema,
  updateTicketStatusZodSchema,
  assignTicketZodSchema,
};

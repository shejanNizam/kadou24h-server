import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ADMIN_ROLES, AppMode, UserRole } from "../user/user.interface";
import { SupportTicketServices } from "./support_ticket.service";

const createTicket = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const userMode = req.user.lastActiveMode || AppMode.customer;
  const result = await SupportTicketServices.createTicket(userId, userMode, req.body);

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Support ticket created successfully",
    data: result,
  });
});

const getMyTickets = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const result = await SupportTicketServices.getMyTickets(userId, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Support tickets retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getTicketById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user._id;
  const ticketId = req.params.id as string;
  const isAdmin = req.user.roles?.some((role: UserRole) => ADMIN_ROLES.includes(role));
  const result = await SupportTicketServices.getTicketById(userId, ticketId, Boolean(isAdmin));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Support ticket details retrieved successfully",
    data: result,
  });
});

const getAllTicketsAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportTicketServices.getAllTicketsAdmin(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin support tickets queue retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const assignTicketAdmin = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user._id;
  const ticketId = req.params.id as string;
  const { assignedTo } = req.body;
  const result = await SupportTicketServices.assignTicketAdmin(adminId, ticketId, assignedTo);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ticket assigned successfully",
    data: result,
  });
});

const updateTicketStatusAdmin = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user._id;
  const ticketId = req.params.id as string;
  const result = await SupportTicketServices.updateTicketStatusAdmin(adminId, ticketId, req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Ticket status updated successfully",
    data: result,
  });
});

export const SupportTicketControllers = {
  createTicket,
  getMyTickets,
  getTicketById,
  getAllTicketsAdmin,
  assignTicketAdmin,
  updateTicketStatusAdmin,
};

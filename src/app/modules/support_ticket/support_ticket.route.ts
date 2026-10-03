import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES } from "../user/user.interface";
import { SupportTicketControllers } from "./support_ticket.controller";
import { SupportTicketValidations } from "./support_ticket.validation";

const router = Router();

// Admin routes (placed first before dynamic :id)
router.get("/admin/all", checkAuth(...ADMIN_ROLES), SupportTicketControllers.getAllTicketsAdmin);
router.get("/admin/:id", checkAuth(...ADMIN_ROLES), SupportTicketControllers.getTicketById);
router.patch(
  "/admin/:id/assign",
  checkAuth(...ADMIN_ROLES),
  validateRequest(SupportTicketValidations.assignTicketZodSchema),
  SupportTicketControllers.assignTicketAdmin,
);
router.patch(
  "/admin/:id/status",
  checkAuth(...ADMIN_ROLES),
  validateRequest(SupportTicketValidations.updateTicketStatusZodSchema),
  SupportTicketControllers.updateTicketStatusAdmin,
);

// User routes
router.post(
  "/",
  checkAuth(...ALL_ROLES),
  validateRequest(SupportTicketValidations.createTicketZodSchema),
  SupportTicketControllers.createTicket,
);

router.get("/me", checkAuth(...ALL_ROLES), SupportTicketControllers.getMyTickets);
router.get("/me/:id", checkAuth(...ALL_ROLES), SupportTicketControllers.getTicketById);

export const SupportTicketRoutes = router;

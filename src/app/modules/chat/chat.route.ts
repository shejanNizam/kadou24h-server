import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES } from "../user/user.interface";
import { ChatControllers } from "./chat.controller";
import { ChatValidations } from "./chat.validation";

const router = Router();

// Admin routes (must be placed before dynamic :id routes)
router.get(
  "/admin/moderation-violations",
  checkAuth(...ADMIN_ROLES),
  ChatControllers.getModerationViolationsAdmin,
);
router.post(
  "/admin/users/:userId/lift-restriction",
  checkAuth(...ADMIN_ROLES),
  ChatControllers.liftUserChatRestrictionAdmin,
);

// User conversation routes
router.post(
  "/",
  checkAuth(...ALL_ROLES),
  validateRequest(ChatValidations.startConversationZodSchema),
  ChatControllers.startOrGetConversation,
);

router.get("/", checkAuth(...ALL_ROLES), ChatControllers.getMyConversations);
router.get("/:id", checkAuth(...ALL_ROLES), ChatControllers.getConversationById);
router.patch("/:id/read", checkAuth(...ALL_ROLES), ChatControllers.markConversationAsRead);

// Messages in conversation
router.get("/:id/messages", checkAuth(...ALL_ROLES), ChatControllers.getMessages);
router.post(
  "/:id/messages",
  checkAuth(...ALL_ROLES),
  validateRequest(ChatValidations.sendMessageZodSchema),
  ChatControllers.sendMessage,
);

export const ChatRoutes = router;

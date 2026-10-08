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

/**
 * @swagger
 * /conversations:
 *   get:
 *     tags: [Chat]
 *     summary: Get my active chat conversations
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations
 *   post:
 *     tags: [Chat]
 *     summary: Start or get an existing conversation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [participantId]
 *             properties:
 *               participantId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *               orderId: { type: string }
 *     responses:
 *       200:
 *         description: Conversation retrieved or created
 */
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

/**
 * @swagger
 * /conversations/{id}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: Get messages in a conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of messages
 *   post:
 *     tags: [Chat]
 *     summary: Send message in conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, example: "Hello, is the order ready for pickup?" }
 *     responses:
 *       201:
 *         description: Message sent
 */
router.get("/:id/messages", checkAuth(...ALL_ROLES), ChatControllers.getMessages);
router.post(
  "/:id/messages",
  checkAuth(...ALL_ROLES),
  validateRequest(ChatValidations.sendMessageZodSchema),
  ChatControllers.sendMessage,
);

export const ChatRoutes = router;

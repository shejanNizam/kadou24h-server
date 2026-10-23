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
 *             description: "Say what the chat is about; the server finds the other person and the modes. One of: { type: buyer_seller, vendorId } · { type: worker, workerProfileId } · { type: order, subOrderId, with: vendor|rider|customer } · { type: job_application, applicationId }. Voice notes are allowed in every chat except job applications."
 *             type: object
 *             required: [type]
 *             properties:
 *               type: { type: string, enum: [buyer_seller, worker, order, job_application] }
 *               vendorId: { type: string }
 *               workerProfileId: { type: string }
 *               subOrderId: { type: string }
 *               with: { type: string, enum: [vendor, rider, customer] }
 *               applicationId: { type: string }
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
/**
 * @swagger
 * /conversations/unread-count:
 *   get:
 *     tags: [Chat]
 *     summary: Total unread messages for one mode (chat tab badge)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: mode
 *         schema: { type: string, enum: [customer, vendor, rider] }
 *     responses:
 *       200: { description: "{ unreadCount }" }
 */
router.get("/unread-count", checkAuth(...ALL_ROLES), ChatControllers.getUnreadCount);
/**
 * @swagger
 * /conversations/blocked:
 *   get:
 *     tags: [Chat]
 *     summary: People I blocked (name, avatar, date)
 *     security: [{ bearerAuth: [] }]
 * /conversations/blocked/{userId}:
 *   delete:
 *     tags: [Chat]
 *     summary: Unblock someone from my blocked list
 *     security: [{ bearerAuth: [] }]
 * /conversations/{id}/block:
 *   post:
 *     tags: [Chat]
 *     summary: Block the other person of this conversation
 *     description: >
 *       Their messages are kept for them only: no unread, no notification, never shown to me — they
 *       are not told. While an order (sub-order not delivered / cancelled) or a booking between us is
 *       still open, messages about it still get through. Conversations show blockedByMe.
 *     security: [{ bearerAuth: [] }]
 *   delete:
 *     tags: [Chat]
 *     summary: Unblock the other person of this conversation
 *     security: [{ bearerAuth: [] }]
 */
router.get("/blocked", checkAuth(...ALL_ROLES), ChatControllers.getBlocked);
router.delete("/blocked/:userId", checkAuth(...ALL_ROLES), ChatControllers.unblockUser);
router.post("/:id/block", checkAuth(...ALL_ROLES), ChatControllers.blockPeer);
router.delete("/:id/block", checkAuth(...ALL_ROLES), ChatControllers.unblockPeer);
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

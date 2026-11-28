import { Router } from "express";
import { z } from "zod";
import { checkAuth } from "../../middlewares/checkAuth";
import { assistantLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { objectIdSchema } from "../../utils/commonSchemas";
import { ADMIN_ROLES, ALL_ROLES } from "../user/user.interface";
import { AssistantControllers } from "./ai_assistant.controller";
import { AssistantValidations } from "./ai_assistant.validation";

const router = Router();

/**
 * @swagger
 * /assistant/admin/usage:
 *   get:
 *     tags: [Assistant]
 *     summary: Today's use of the help assistant (questions, conversations, hand-overs) and whether a key is set
 *     security:
 *       - bearerAuth: []
 */
router.get("/admin/usage", checkAuth(...ADMIN_ROLES), AssistantControllers.getUsageAdmin);

/**
 * @swagger
 * /assistant/admin/conversations/{id}:
 *   get:
 *     tags: [Assistant]
 *     summary: One conversation with the assistant (linked from a support ticket)
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/admin/conversations/:id",
  checkAuth(...ADMIN_ROLES),
  validateRequest(z.object({ params: z.object({ id: objectIdSchema }) })),
  AssistantControllers.getConversationAdmin,
);

/**
 * @swagger
 * /assistant/conversation:
 *   get:
 *     tags: [Assistant]
 *     summary: My conversation with the help assistant (or null), whether it is available, today's questions used / limit
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     tags: [Assistant]
 *     summary: Start again (closes the current conversation)
 *     security:
 *       - bearerAuth: []
 */
router.get("/conversation", checkAuth(...ALL_ROLES), AssistantControllers.getCurrent);
router.delete("/conversation", checkAuth(...ALL_ROLES), AssistantControllers.closeCurrent);

/**
 * @swagger
 * /assistant/messages:
 *   post:
 *     tags: [Assistant]
 *     summary: Ask a question (text 2-500 chars, optional mode); returns the conversation with the answer
 *     description: 429 ASSISTANT_DAILY_LIMIT / ASSISTANT_BUSY, 503 ASSISTANT_UNAVAILABLE, 502 ASSISTANT_FAILED (not counted)
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/messages",
  checkAuth(...ALL_ROLES),
  assistantLimiter,
  validateRequest(AssistantValidations.sendMessageZodSchema),
  AssistantControllers.sendMessage,
);

/**
 * @swagger
 * /assistant/conversation/hand-off:
 *   post:
 *     tags: [Assistant]
 *     summary: Send the conversation to the support team (creates a support ticket; optional note)
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/conversation/hand-off",
  checkAuth(...ALL_ROLES),
  validateRequest(AssistantValidations.handOffZodSchema),
  AssistantControllers.handOff,
);

export const AssistantRoutes = router;

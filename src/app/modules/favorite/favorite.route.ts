import { Router } from "express";
import z from "zod";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { objectIdSchema } from "../../utils/commonSchemas";
import { APP_ROLES } from "../user/user.interface";
import { FavoriteControllers } from "./favorite.controller";

const router = Router();

const toggleFavoriteZodSchema = z.object({
  body: z.object({
    productId: objectIdSchema,
  }),
});

// All favorite routes require signed-in user
router.use(checkAuth(...APP_ROLES));

/**
 * @swagger
 * /favorites/my-favorites:
 *   get:
 *     tags: [Favorite]
 *     summary: Get my wishlist / favorite products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of favorited products
 */
router.get("/my-favorites", FavoriteControllers.getMyFavorites);

/**
 * @swagger
 * /favorites/check/{productId}:
 *   get:
 *     tags: [Favorite]
 *     summary: Check if a product is favorited by current user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Boolean check status
 */
router.get("/check/:productId", FavoriteControllers.checkIsFavorite);

/**
 * @swagger
 * /favorites/toggle:
 *   post:
 *     tags: [Favorite]
 *     summary: Toggle product favorite status (add or remove)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId:
 *                 type: string
 *                 example: "65b4c1a2d3e4f5a6b7c8d9e0"
 *     responses:
 *       200:
 *         description: Toggled favorite status
 */
router.post(
  "/toggle",
  validateRequest(toggleFavoriteZodSchema),
  FavoriteControllers.toggleFavorite,
);

export const FavoriteRoutes = router;

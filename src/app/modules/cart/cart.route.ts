import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ALL_ROLES } from "../user/user.interface";
import { CartControllers } from "./cart.controller";
import { CartValidations } from "./cart.validation";

const router = Router();

router.use(checkAuth(...ALL_ROLES));

/**
 * @swagger
 * /cart:
 *   get:
 *     tags: [Cart]
 *     summary: Get my shopping cart
 *     description: Retrieve all items currently in the signed-in user's cart with store groupings and calculated subtotal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart details retrieved successfully
 *   delete:
 *     tags: [Cart]
 *     summary: Clear entire cart
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared successfully
 */
router.get("/", CartControllers.getMyCart);
router.delete("/", CartControllers.clearCart);

/**
 * @swagger
 * /cart/suggestions:
 *   get:
 *     tags: [Cart]
 *     summary: Customers also bought
 *     description: Approved, in-stock products bought in the same orders as the cart's products (most often first), topped up with best sellers of the same categories. Excludes the cart's products. Empty when the cart is empty.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 20
 *     responses:
 *       200:
 *         description: Product list (same shape as GET /products items)
 */
router.get("/suggestions", CartControllers.getSuggestions);

/**
 * @swagger
 * /cart/items:
 *   post:
 *     tags: [Cart]
 *     summary: Add item to cart
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, qty]
 *             properties:
 *               productId:
 *                 type: string
 *                 example: "65b4c1a2d3e4f5a6b7c8d9e0"
 *               qty:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       200:
 *         description: Item added to cart
 */
router.post(
  "/items",
  validateRequest(CartValidations.addItemSchema),
  CartControllers.addToCart,
);

/**
 * @swagger
 * /cart/items/{productId}:
 *   patch:
 *     tags: [Cart]
 *     summary: Update cart item quantity
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [qty]
 *             properties:
 *               qty:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       200:
 *         description: Item quantity updated
 *   delete:
 *     tags: [Cart]
 *     summary: Remove item from cart
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
 *         description: Item removed from cart
 */
router.patch(
  "/items/:productId",
  validateRequest(CartValidations.updateQtySchema),
  CartControllers.updateItemQty,
);

router.delete("/items/:productId", CartControllers.removeItem);

export const CartRoutes = router;

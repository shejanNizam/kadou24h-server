import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES, UserRole } from "../user/user.interface";
import { OrderControllers } from "./order.controller";
import { OrderValidations } from "./order.validation";

const router = Router();
const vendorRoles = [UserRole.vendor, ...ADMIN_ROLES];

// --- Customer Order & Checkout Routes ---

/**
 * @swagger
 * /orders/checkout-summary:
 *   post:
 *     tags: [Order]
 *     summary: Calculate checkout summary & breakdown (fees, delivery, totals)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deliveryType, paymentMethod]
 *             properties:
 *               addressId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *               deliveryType: { type: string, enum: [direct, transit] }
 *               paymentMethod: { type: string, enum: [cod, orange_money, card] }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     qty: { type: integer }
 *     responses:
 *       200:
 *         description: Checkout summary with cost breakdown
 */
router.post(
  "/checkout-summary",
  checkAuth(...ALL_ROLES),
  validateRequest(OrderValidations.checkoutSummarySchema),
  OrderControllers.checkoutSummary,
);

/**
 * @swagger
 * /orders:
 *   post:
 *     tags: [Order]
 *     summary: Place a new order
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deliveryType, paymentMethod]
 *             properties:
 *               addressId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *               deliveryType: { type: string, enum: [direct, transit] }
 *               paymentMethod: { type: string, enum: [cod, orange_money, card] }
 *               specialInstructions: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     qty: { type: integer }
 *     responses:
 *       201:
 *         description: Order placed successfully
 */
router.post(
  "/",
  checkAuth(...ALL_ROLES),
  validateRequest(OrderValidations.placeOrderSchema),
  OrderControllers.placeOrder,
);

/**
 * @swagger
 * /orders/my-orders:
 *   get:
 *     tags: [Order]
 *     summary: Get my orders history (Customer)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Customer order history
 */
router.get("/my-orders", checkAuth(...ALL_ROLES), OrderControllers.getMyOrders);

// --- Vendor Sub-Order Routes ---

/**
 * @swagger
 * /orders/vendor/sub-orders:
 *   get:
 *     tags: [Order]
 *     summary: Get vendor incoming sub-orders (Vendor)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Sub-orders for current vendor
 */
router.get(
  "/vendor/sub-orders",
  checkAuth(...vendorRoles),
  OrderControllers.getVendorSubOrders,
);

/**
 * @swagger
 * /orders/vendor/sub-orders/{id}:
 *   get:
 *     tags: [Order]
 *     summary: Get single vendor sub-order detail (Vendor)
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
 *         description: Vendor sub-order detail
 */
router.get(
  "/vendor/sub-orders/:id",
  checkAuth(...vendorRoles),
  OrderControllers.getVendorSubOrderDetail,
);

/**
 * @swagger
 * /orders/vendor/sub-orders/{id}/status:
 *   patch:
 *     tags: [Order]
 *     summary: Update sub-order preparation status (Vendor)
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [accepted, preparing, ready_for_pickup] }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Sub-order status updated
 */
router.patch(
  "/vendor/sub-orders/:id/status",
  checkAuth(...vendorRoles),
  validateRequest(OrderValidations.vendorStatusUpdateSchema),
  OrderControllers.updateSubOrderStatus,
);

router.patch(
  "/vendor/sub-orders/:id/modify",
  checkAuth(...vendorRoles),
  validateRequest(OrderValidations.vendorModifyOrderSchema),
  OrderControllers.modifySubOrderItems,
);

/**
 * @swagger
 * /orders/vendor/sub-orders/{id}/cancel:
 *   post:
 *     tags: [Order]
 *     summary: Cancel vendor sub-order (Vendor)
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Sub-order cancelled
 */
router.post(
  "/vendor/sub-orders/:id/cancel",
  checkAuth(...vendorRoles),
  validateRequest(OrderValidations.cancelOrderSchema),
  OrderControllers.cancelVendorSubOrder,
);

// --- Admin Order Routes ---

/**
 * @swagger
 * /orders/admin/all:
 *   get:
 *     tags: [Order]
 *     summary: Get all platform orders (Admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: All platform orders
 */
router.get(
  "/admin/all",
  checkAuth(...ADMIN_ROLES),
  OrderControllers.getAllOrdersAdmin,
);

router.get(
  "/admin/:id",
  checkAuth(...ADMIN_ROLES),
  OrderControllers.getAdminOrderDetail,
);

router.post(
  "/admin/sub-orders/:id/cancel",
  checkAuth(...ADMIN_ROLES),
  validateRequest(OrderValidations.cancelOrderSchema),
  OrderControllers.adminCancelSubOrder,
);

// --- Detail & Cancel by Customer ---

/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     tags: [Order]
 *     summary: Get order details by ID (Customer / Admin)
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
 *         description: Order details
 */
router.get("/:id", checkAuth(...ALL_ROLES), OrderControllers.getOrderDetails);

/**
 * @swagger
 * /orders/{id}/cancel:
 *   post:
 *     tags: [Order]
 *     summary: Cancel order (Customer)
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Order cancelled
 */
router.post(
  "/:id/cancel",
  checkAuth(...ALL_ROLES),
  validateRequest(OrderValidations.cancelOrderSchema),
  OrderControllers.cancelOrder,
);

/**
 * @swagger
 * /orders/{id}/sub-orders/{subOrderId}/cancel:
 *   post:
 *     tags: [Order]
 *     summary: Cancel one store's part of my order (Customer) — { reason }
 *     description: >
 *       Only while that store has not started preparing (new / accepted). Paid online → a refund
 *       request for that part. Not for an unpaid online order (pay or cancel the whole order).
 *       The last part cancelled = the whole order (service fee refunded, promo code given back).
 *       Cash on delivery: the service fee moves to another part.
 *     security:
 *       - bearerAuth: []
 */
router.post(
  "/:id/sub-orders/:subOrderId/cancel",
  checkAuth(...ALL_ROLES),
  validateRequest(OrderValidations.cancelOrderSchema),
  OrderControllers.cancelStorePart,
);

export const OrderRoutes = router;

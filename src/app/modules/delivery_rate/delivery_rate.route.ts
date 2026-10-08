import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ALL_ROLES, UserRole } from "../user/user.interface";
import { DeliveryRateControllers } from "./delivery_rate.controller";
import { DeliveryRateValidations } from "./delivery_rate.validation";

const router = Router();
const manageRoles = [UserRole.admin, UserRole.super_admin];

/**
 * @swagger
 * /delivery-rates/calculate:
 *   get:
 *     tags: [Delivery]
 *     summary: Calculate delivery fee (local distance or intercity route)
 *     parameters:
 *       - in: query
 *         name: originLat
 *         schema:
 *           type: number
 *       - in: query
 *         name: originLng
 *         schema:
 *           type: number
 *       - in: query
 *         name: destinationLat
 *         schema:
 *           type: number
 *       - in: query
 *         name: destinationLng
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Calculated delivery fee
 */
router.get("/calculate", DeliveryRateControllers.calculateDeliveryFee);

/**
 * @swagger
 * /delivery-rates:
 *   get:
 *     tags: [Delivery]
 *     summary: List delivery rates
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of delivery rates
 *   post:
 *     tags: [Settings]
 *     summary: Create a new delivery rate tier (Admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, baseFee, perKmRate]
 *             properties:
 *               name: { type: string, example: "Standard City Delivery" }
 *               baseFee: { type: number, example: 5000 }
 *               perKmRate: { type: number, example: 1000 }
 *     responses:
 *       201:
 *         description: Delivery rate created
 */
router.get(
  "/",
  checkAuth(...ALL_ROLES),
  DeliveryRateControllers.getAllDeliveryRates,
);

router.get(
  "/:id",
  checkAuth(...ALL_ROLES),
  DeliveryRateControllers.getDeliveryRateById,
);

router.post(
  "/",
  checkAuth(...manageRoles),
  validateRequest(DeliveryRateValidations.createDeliveryRateSchema),
  DeliveryRateControllers.createDeliveryRate,
);

router.patch(
  "/:id",
  checkAuth(...manageRoles),
  validateRequest(DeliveryRateValidations.updateDeliveryRateSchema),
  DeliveryRateControllers.updateDeliveryRate,
);

router.delete(
  "/:id",
  checkAuth(...manageRoles),
  DeliveryRateControllers.deleteDeliveryRate,
);

export const DeliveryRateRoutes = router;

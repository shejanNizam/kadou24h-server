import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, ALL_ROLES, UserRole } from "../user/user.interface";
import { DeliveryControllers } from "./delivery.controller";
import { DeliveryValidations } from "./delivery.validation";

const router = Router();
const riderRoles = [UserRole.rider, ...ADMIN_ROLES];
const vendorRoles = [UserRole.vendor, ...ADMIN_ROLES];

// --- Rider Real-time Location & Driver Mode ---

/**
 * @swagger
 * /deliveries/rider/location:
 *   patch:
 *     tags: [Delivery]
 *     summary: Update rider current GPS location (Rider)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number, example: 9.5092 }
 *               lng: { type: number, example: -13.7122 }
 *               heading: { type: number, example: 180 }
 *     responses:
 *       200:
 *         description: Location updated successfully
 */
router.patch(
  "/rider/location",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.updateLocationSchema),
  DeliveryControllers.updateRiderLocation,
);

/**
 * @swagger
 * /deliveries/rider/online-status:
 *   patch:
 *     tags: [Delivery]
 *     summary: Toggle rider duty status (Online / Offline) (Rider)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isOnline]
 *             properties:
 *               isOnline: { type: boolean, example: true }
 *     responses:
 *       200:
 *         description: Online status toggled
 */
router.patch(
  "/rider/online-status",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.toggleOnlineSchema),
  DeliveryControllers.toggleRiderOnline,
);

/**
 * @swagger
 * /deliveries/rider/my-deliveries:
 *   get:
 *     tags: [Delivery]
 *     summary: Get rider assigned deliveries & trips (Rider)
 *     description: >
 *       Tabs with `type`: new (assigned, waiting for my answer), ongoing (accepted → in transit),
 *       completed (delivered / cancelled), active (new + ongoing). Running tabs are oldest first.
 *       Each row has `subOrderId.codAmountToCollect` (cash to collect when `collectsCash`).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [new, ongoing, completed, active]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Rider deliveries list
 */
router.get(
  "/rider/my-deliveries",
  checkAuth(...riderRoles),
  DeliveryControllers.getMyDeliveries,
);

// --- Vendor Assignment ---

/**
 * @swagger
 * /deliveries/{id}/available-riders:
 *   get:
 *     tags: [Delivery]
 *     summary: Find available riders for a delivery order (Vendor)
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
 *         description: List of available riders
 */
router.get(
  "/:id/available-riders",
  checkAuth(...vendorRoles),
  DeliveryControllers.getAvailableRiders,
);

/**
 * @swagger
 * /deliveries/{id}/assign:
 *   post:
 *     tags: [Delivery]
 *     summary: Assign delivery to a rider (Vendor)
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
 *             required: [riderId]
 *             properties:
 *               riderId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *     responses:
 *       200:
 *         description: Delivery assigned
 */
router.post(
  "/:id/assign",
  checkAuth(...vendorRoles),
  validateRequest(DeliveryValidations.assignRiderSchema),
  DeliveryControllers.assignRider,
);

// --- Rider Leg Lifecycle ---

/**
 * @swagger
 * /deliveries/{id}/accept:
 *   post:
 *     tags: [Delivery]
 *     summary: Accept incoming delivery request (Rider)
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
 *         description: Delivery accepted
 */
router.post(
  "/:id/accept",
  checkAuth(...riderRoles),
  DeliveryControllers.acceptDelivery,
);

/**
 * @swagger
 * /deliveries/{id}/decline:
 *   post:
 *     tags: [Delivery]
 *     summary: Decline incoming delivery request (Rider)
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
 *         description: Delivery declined
 */
router.post(
  "/:id/decline",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.declineDeliverySchema),
  DeliveryControllers.declineDelivery,
);

/**
 * @swagger
 * /deliveries/{id}/going-to-pickup:
 *   patch:
 *     tags: [Delivery]
 *     summary: Rider is heading to store pickup location (Rider)
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
 *         description: Status updated to going_to_pickup
 */
router.patch(
  "/:id/going-to-pickup",
  checkAuth(...riderRoles),
  DeliveryControllers.goingToPickup,
);

/**
 * @swagger
 * /deliveries/{id}/verify-pickup:
 *   post:
 *     tags: [Delivery]
 *     summary: Verify pickup from store with PIN (Rider)
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
 *             required: [pin]
 *             properties:
 *               pin: { type: string, example: "1234" }
 *               proofPhoto:
 *                 $ref: '#/components/schemas/FileRef'
 *     responses:
 *       200:
 *         description: Pickup verified
 */
router.post(
  "/:id/verify-pickup",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.verifyPinSchema),
  DeliveryControllers.verifyPickup,
);

/**
 * @swagger
 * /deliveries/{id}/verify-handover:
 *   post:
 *     tags: [Delivery]
 *     summary: Verify customer delivery handover with PIN (Rider)
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
 *             required: [pin]
 *             properties:
 *               pin: { type: string, example: "5678" }
 *               proofPhoto:
 *                 $ref: '#/components/schemas/FileRef'
 *     responses:
 *       200:
 *         description: Delivery handover completed
 */
router.post(
  "/:id/verify-handover",
  checkAuth(...riderRoles),
  validateRequest(DeliveryValidations.verifyPinSchema),
  DeliveryControllers.verifyHandover,
);

// --- Live Tracking Details ---

/**
 * @swagger
 * /deliveries/{id}/track:
 *   get:
 *     tags: [Delivery]
 *     summary: Track live delivery status, timeline & GPS (Customer / Rider / Vendor)
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
 *         description: Real-time tracking data
 */
router.get("/:id/track", checkAuth(...ALL_ROLES), DeliveryControllers.trackDelivery);

export const DeliveryRoutes = router;

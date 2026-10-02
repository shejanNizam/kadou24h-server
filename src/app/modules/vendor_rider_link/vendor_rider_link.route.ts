import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { VendorRiderLinkControllers } from "./vendor_rider_link.controller";
import {
  inviteRiderZodSchema,
  requestVendorZodSchema,
  respondLinkZodSchema,
} from "./vendor_rider_link.validation";

const router = Router();
const parties = [UserRole.vendor, UserRole.rider];

/**
 * @swagger
 * /vendor-rider-links/me:
 *   get:
 *     tags: [Vendor–Rider Link]
 *     summary: My connections — as=vendor lists riders, as=rider lists stores
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: as, required: true, schema: { type: string, enum: [vendor, rider] } }
 *       - { in: query, name: status, schema: { type: string, enum: [invited, active, declined, removed] } }
 *     responses:
 *       200:
 *         description: Connections with the other party's public info
 * /vendor-rider-links/invite:
 *   post:
 *     tags: [Vendor–Rider Link]
 *     summary: Vendor invites a rider (find riders with GET /riders/search)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [riderId]
 *             properties:
 *               riderId: { type: string, description: "rider_profiles _id" }
 *     responses:
 *       200:
 *         description: "Invitation sent (or connected, if the rider had already asked)"
 *       409:
 *         description: Already connected / already invited
 * /vendor-rider-links/request:
 *   post:
 *     tags: [Vendor–Rider Link]
 *     summary: Rider asks to join a store's rider network (find stores with GET /vendors)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId]
 *             properties:
 *               vendorId: { type: string, description: "vendor_profiles _id" }
 *     responses:
 *       200:
 *         description: Request sent (or connected)
 * /vendor-rider-links/{id}/respond:
 *   patch:
 *     tags: [Vendor–Rider Link]
 *     summary: The invited party accepts or declines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accept]
 *             properties:
 *               accept: { type: boolean }
 *     responses:
 *       200:
 *         description: active / declined
 * /vendor-rider-links/{id}:
 *   delete:
 *     tags: [Vendor–Rider Link]
 *     summary: Either side ends the connection
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: removed
 */
router.get("/me", checkAuth(...parties), VendorRiderLinkControllers.getMyLinks);
router.post(
  "/invite",
  checkAuth(UserRole.vendor),
  validateRequest(inviteRiderZodSchema),
  VendorRiderLinkControllers.inviteRider,
);
router.post(
  "/request",
  checkAuth(UserRole.rider),
  validateRequest(requestVendorZodSchema),
  VendorRiderLinkControllers.requestVendor,
);
router.patch(
  "/:id/respond",
  checkAuth(...parties),
  validateRequest(respondLinkZodSchema),
  VendorRiderLinkControllers.respond,
);
router.delete("/:id", checkAuth(...parties), VendorRiderLinkControllers.remove);

export const VendorRiderLinkRoutes = router;

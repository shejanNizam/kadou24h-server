import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, UserRole } from "../user/user.interface";
import { TransitStationControllers } from "./transit_station.controller";
import {
  createTransitStationZodSchema,
  updateTransitStationZodSchema,
} from "./transit_station.validation";

const router = Router();
const manageRoles = [UserRole.admin, UserRole.super_admin];

/**
 * @swagger
 * /transit-stations:
 *   get:
 *     tags: [Transit Station]
 *     summary: Active bus stations (public) — for bus-driver routes and station pickup
 *     parameters:
 *       - { in: query, name: city, schema: { type: string, example: Conakry } }
 *     responses:
 *       200:
 *         description: "[{ _id, name, city, region, location: { lat, lng }, isActive }]"
 *   post:
 *     tags: [Transit Station]
 *     summary: Create a bus station (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, city, location]
 *             properties:
 *               name: { type: string, example: "Gare routière de Madina" }
 *               city: { type: string, example: Conakry }
 *               region: { type: string, example: Conakry }
 *               location: { $ref: '#/components/schemas/LatLng' }
 *     responses:
 *       201:
 *         description: Created
 * /transit-stations/admin:
 *   get:
 *     tags: [Transit Station]
 *     summary: All stations incl. inactive (admin panel)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Station list
 * /transit-stations/{id}:
 *   patch:
 *     tags: [Transit Station]
 *     summary: Update / deactivate a station (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Updated
 */
router.get("/", TransitStationControllers.getStations);
router.get("/admin", checkAuth(...ADMIN_ROLES), TransitStationControllers.getStationsForAdmin);
router.post(
  "/",
  checkAuth(...manageRoles),
  validateRequest(createTransitStationZodSchema),
  TransitStationControllers.createStation,
);
router.patch(
  "/:id",
  checkAuth(...manageRoles),
  validateRequest(updateTransitStationZodSchema),
  TransitStationControllers.updateStation,
);

export const TransitStationRoutes = router;

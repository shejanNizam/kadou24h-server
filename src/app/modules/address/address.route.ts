import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { APP_ROLES } from "../user/user.interface";
import { AddressControllers } from "./address.controller";
import { createAddressZodSchema, updateAddressZodSchema } from "./address.validation";

const router = Router();

/**
 * @swagger
 * /addresses:
 *   get:
 *     tags: [Address]
 *     summary: My saved addresses (default first)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Address list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Address'
 *   post:
 *     tags: [Address]
 *     summary: Add an address (max 10; the first one becomes default)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddressRequest'
 *     responses:
 *       201:
 *         description: Address created
 * /addresses/{addressId}:
 *   patch:
 *     tags: [Address]
 *     summary: Update an address (any subset of fields)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: addressId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddressRequest'
 *     responses:
 *       200:
 *         description: Address updated
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [Address]
 *     summary: Delete an address (another one becomes default if needed)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: addressId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Deleted
 * /addresses/{addressId}/default:
 *   patch:
 *     tags: [Address]
 *     summary: Make this the default delivery address
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: addressId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Default updated
 */
router.get("/", checkAuth(...APP_ROLES), AddressControllers.getMyAddresses);
router.post(
  "/",
  checkAuth(...APP_ROLES),
  validateRequest(createAddressZodSchema),
  AddressControllers.createAddress,
);
router.patch(
  "/:addressId",
  checkAuth(...APP_ROLES),
  validateRequest(updateAddressZodSchema),
  AddressControllers.updateAddress,
);
router.patch("/:addressId/default", checkAuth(...APP_ROLES), AddressControllers.setDefaultAddress);
router.delete("/:addressId", checkAuth(...APP_ROLES), AddressControllers.deleteAddress);

export const AddressRoutes = router;

import { Router } from "express";
import { checkAuth, optionalAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, UserRole } from "../user/user.interface";
import { ProductControllers } from "./product.controller";
import { ProductValidations } from "./product.validation";

const router = Router();

/**
 * @swagger
 * /products:
 *   get:
 *     tags: [Product]
 *     summary: Browse and search products (Public)
 *     parameters:
 *       - in: query
 *         name: searchTerm
 *         schema:
 *           type: string
 *         description: Search by name, description or tags
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: isFeatured
 *         schema:
 *           type: boolean
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - $ref: '#/components/parameters/sort'
 *     responses:
 *       200:
 *         description: Paginated public products
 *   post:
 *     tags: [Product]
 *     summary: Create new product (Vendor or Admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, categoryId, price]
 *             properties:
 *               name: { type: string, example: "Smart Watch Series 9" }
 *               categoryId: { type: string, example: "65b4c1a2d3e4f5a6b7c8d9e0" }
 *               description: { type: string, example: "High quality smartwatch with heart rate sensor" }
 *               price: { type: number, example: 250000 }
 *               discountPrice: { type: number, example: 200000 }
 *               stockQty: { type: integer, example: 15 }
 *               isAvailable: { type: boolean, example: true }
 *               images:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/FileRef'
 *     responses:
 *       201:
 *         description: Product created successfully
 */
router.get("/", ProductControllers.getPublicProducts);
router.post(
  "/",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  validateRequest(ProductValidations.createProductZodSchema),
  ProductControllers.createProduct,
);

/**
 * @swagger
 * /products/admin:
 *   get:
 *     tags: [Product]
 *     summary: Get all products with review stats (Admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/searchTerm'
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Products with admin metadata
 */
router.get(
  "/admin",
  checkAuth(...ADMIN_ROLES),
  ProductControllers.getAdminProducts,
);

/**
 * @swagger
 * /products/my-products:
 *   get:
 *     tags: [Product]
 *     summary: Get my store products (Vendor)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/searchTerm'
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: Vendor store products
 */
router.get(
  "/my-products",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  ProductControllers.getVendorProducts,
);

/**
 * @swagger
 * /products/{idOrSlug}:
 *   get:
 *     tags: [Product]
 *     summary: Get single product by ID or slug (Public)
 *     parameters:
 *       - in: path
 *         name: idOrSlug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detailed product information
 */
router.get("/:idOrSlug", optionalAuth, ProductControllers.getProductByIdOrSlug);

/**
 * @swagger
 * /products/{id}:
 *   patch:
 *     tags: [Product]
 *     summary: Update product details (Vendor or Admin)
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
 *             properties:
 *               name: { type: string }
 *               price: { type: number }
 *               stockQty: { type: integer }
 *               isAvailable: { type: boolean }
 *     responses:
 *       200:
 *         description: Product updated successfully
 *   delete:
 *     tags: [Product]
 *     summary: Soft delete product (Vendor or Admin)
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
 *         description: Product deleted successfully
 */
router.patch(
  "/:id",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  validateRequest(ProductValidations.updateProductZodSchema),
  ProductControllers.updateProduct,
);

router.delete(
  "/:id",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  ProductControllers.deleteProduct,
);

/**
 * @swagger
 * /products/{id}/stock:
 *   patch:
 *     tags: [Product]
 *     summary: Quick update stock & availability (Vendor or Admin)
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
 *             properties:
 *               stockQty: { type: integer, example: 50 }
 *               isAvailable: { type: boolean, example: true }
 *     responses:
 *       200:
 *         description: Stock updated successfully
 */
router.patch(
  "/:id/stock",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  validateRequest(ProductValidations.updateStockZodSchema),
  ProductControllers.updateProductStock,
);

/**
 * @swagger
 * /products/{id}/approval:
 *   patch:
 *     tags: [Product]
 *     summary: Review product approval status (Admin only)
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
 *             required: [approvalStatus]
 *             properties:
 *               approvalStatus: { type: string, enum: [approved, rejected] }
 *               adminReviewNote: { type: string }
 *     responses:
 *       200:
 *         description: Product approval status updated
 */
router.patch(
  "/:id/approval",
  checkAuth(...ADMIN_ROLES),
  validateRequest(ProductValidations.reviewProductApprovalZodSchema),
  ProductControllers.reviewProductApproval,
);

export const ProductRoutes = router;

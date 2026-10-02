import { Router } from "express";
import { checkAuth, optionalAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, UserRole } from "../user/user.interface";
import { ProductControllers } from "./product.controller";
import { ProductValidations } from "./product.validation";

const router = Router();

// Public: Browse and search products
router.get("/", ProductControllers.getPublicProducts);

// Admin: Get all products with summary stats
router.get(
  "/admin",
  checkAuth(...ADMIN_ROLES),
  ProductControllers.getAdminProducts,
);

// Vendor: Get my store products
router.get(
  "/my-products",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  ProductControllers.getVendorProducts,
);

// Public / Optional auth: Get single product by id or slug
router.get("/:idOrSlug", optionalAuth, ProductControllers.getProductByIdOrSlug);

// Vendor or Admin: Create new product
router.post(
  "/",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  validateRequest(ProductValidations.createProductZodSchema),
  ProductControllers.createProduct,
);

// Vendor or Admin: Update product details
router.patch(
  "/:id",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  validateRequest(ProductValidations.updateProductZodSchema),
  ProductControllers.updateProduct,
);

// Vendor or Admin: Quick stock and availability toggle
router.patch(
  "/:id/stock",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  validateRequest(ProductValidations.updateStockZodSchema),
  ProductControllers.updateProductStock,
);

// Admin only: Approve or reject product
router.patch(
  "/:id/approval",
  checkAuth(...ADMIN_ROLES),
  validateRequest(ProductValidations.reviewProductApprovalZodSchema),
  ProductControllers.reviewProductApproval,
);

// Vendor or Admin: Soft delete product
router.delete(
  "/:id",
  checkAuth(UserRole.vendor, ...ADMIN_ROLES),
  ProductControllers.deleteProduct,
);

export const ProductRoutes = router;

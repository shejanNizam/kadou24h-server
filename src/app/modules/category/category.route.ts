import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { ADMIN_ROLES, UserRole } from "../user/user.interface";
import { CategoryControllers } from "./category.controller";
import { createCategoryZodSchema, updateCategoryZodSchema } from "./category.validation";

const router = Router();
const manageRoles = [UserRole.admin, UserRole.super_admin];

/**
 * @swagger
 * /categories:
 *   get:
 *     tags: [Category]
 *     summary: Active categories (public)
 *     parameters:
 *       - { in: query, name: type, schema: { type: string, enum: [product, business, service, job] } }
 *       - { in: query, name: featured, schema: { type: boolean }, description: "true = Home 'Top Categories'" }
 *       - { in: query, name: parentId, schema: { type: string }, description: "<id> = its subcategories, 'root' = top level only" }
 *     responses:
 *       200:
 *         description: Category list sorted by sortOrder
 *   post:
 *     tags: [Category]
 *     summary: Create a category or subcategory (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CategoryRequest'
 *     responses:
 *       201:
 *         description: Created
 * /categories/tree:
 *   get:
 *     tags: [Category]
 *     summary: Categories with their subcategories (public)
 *     parameters:
 *       - { in: query, name: type, required: true, schema: { type: string, enum: [product, business, service, job] } }
 *     responses:
 *       200:
 *         description: "[{ ...category, children: [...] }]"
 * /categories/admin:
 *   get:
 *     tags: [Category]
 *     summary: All categories incl. inactive (admin panel)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: type, schema: { type: string } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200:
 *         description: Category list
 * /categories/{id}:
 *   get:
 *     tags: [Category]
 *     summary: One category (public)
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Category
 *   patch:
 *     tags: [Category]
 *     summary: Update name / image / featured / order / active (admin). Type and parent are fixed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     tags: [Category]
 *     summary: Delete (admin) — blocked while it has subcategories; deactivate instead
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/id'
 *     responses:
 *       200:
 *         description: Deleted
 *       409:
 *         description: Has subcategories
 */
router.get("/", CategoryControllers.getCategories);
router.get("/tree", CategoryControllers.getCategoryTree);
router.get("/admin", checkAuth(...ADMIN_ROLES), CategoryControllers.getAllCategoriesForAdmin);
router.get("/:id", CategoryControllers.getSingleCategory);

router.post(
  "/",
  checkAuth(...manageRoles),
  validateRequest(createCategoryZodSchema),
  CategoryControllers.createCategory,
);
router.patch(
  "/:id",
  checkAuth(...manageRoles),
  validateRequest(updateCategoryZodSchema),
  CategoryControllers.updateCategory,
);
router.delete("/:id", checkAuth(...manageRoles), CategoryControllers.deleteCategory);

export const CategoryRoutes = router;

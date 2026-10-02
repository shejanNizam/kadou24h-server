import z from "zod";
import { fileRefZodSchema, objectIdSchema } from "../../utils/commonSchemas";
import { ProductApprovalStatus } from "./product.interface";

const createProductZodSchema = z.object({
  body: z
    .object({
      name: z.string({ error: "Product name is required" }).min(2, "Name must be at least 2 characters").trim(),
      categoryId: objectIdSchema,
      subcategoryId: objectIdSchema.optional(),
      vendorId: objectIdSchema.optional(), // Only admin can specify a different vendorId
      description: z.string().optional(),
      price: z.number({ error: "Price is required" }).min(0, "Price cannot be negative"),
      discountPrice: z.number().min(0, "Discount price cannot be negative").optional(),
      images: z.array(fileRefZodSchema).default([]),
      features: z.array(z.string().trim()).default([]),
      inTheBox: z.array(z.string().trim()).default([]),
      tags: z.array(z.string().trim()).default([]),
      stockQty: z.number().int().min(0, "Stock cannot be negative").default(0),
      minStockAlert: z.number().int().min(0).default(0),
      prepTimeMinutes: z.number().int().min(0).default(15),
      isAvailable: z.boolean().default(true),
    })
    .refine(
      (data) => {
        if (data.discountPrice !== undefined && data.discountPrice >= data.price) {
          return false;
        }
        return true;
      },
      {
        message: "Discount price must be less than the regular price",
        path: ["discountPrice"],
      },
    ),
});

const updateProductZodSchema = z.object({
  body: z
    .object({
      name: z.string().min(2).trim().optional(),
      categoryId: objectIdSchema.optional(),
      subcategoryId: objectIdSchema.optional().nullable(),
      description: z.string().optional(),
      price: z.number().min(0).optional(),
      discountPrice: z.number().min(0).optional().nullable(),
      images: z.array(fileRefZodSchema).optional(),
      features: z.array(z.string().trim()).optional(),
      inTheBox: z.array(z.string().trim()).optional(),
      tags: z.array(z.string().trim()).optional(),
      stockQty: z.number().int().min(0).optional(),
      minStockAlert: z.number().int().min(0).optional(),
      prepTimeMinutes: z.number().int().min(0).optional(),
      isAvailable: z.boolean().optional(),
    })
    .refine(
      (data) => {
        if (
          data.price !== undefined &&
          data.discountPrice !== undefined &&
          data.discountPrice !== null &&
          data.discountPrice >= data.price
        ) {
          return false;
        }
        return true;
      },
      {
        message: "Discount price must be less than the regular price",
        path: ["discountPrice"],
      },
    ),
});

const updateStockZodSchema = z.object({
  body: z.object({
    stockQty: z.number().int().min(0).optional(),
    minStockAlert: z.number().int().min(0).optional(),
    isAvailable: z.boolean().optional(),
  }),
});

const reviewProductApprovalZodSchema = z.object({
  body: z.object({
    approvalStatus: z.enum([ProductApprovalStatus.approved, ProductApprovalStatus.rejected]),
    adminReviewNote: z.string().trim().optional(),
  }),
});

export const ProductValidations = {
  createProductZodSchema,
  updateProductZodSchema,
  updateStockZodSchema,
  reviewProductApprovalZodSchema,
};

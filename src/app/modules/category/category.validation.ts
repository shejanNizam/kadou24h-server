import z from "zod";
import { fileRefZodSchema, objectIdSchema } from "../../utils/commonSchemas";
import { CategoryType } from "./category.interface";

const localizedName = z.object({
  fr: z.string().trim().min(1, { message: "French name is required" }).max(60),
  en: z.string().trim().min(1, { message: "English name is required" }).max(60),
});

export const createCategoryZodSchema = z
  .object({
    name: localizedName,
    type: z.enum(Object.values(CategoryType) as [string, ...string[]]),
    parentId: objectIdSchema.nullable().optional(),
    image: fileRefZodSchema.optional(),
    isFeatured: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

// type / parent cannot change once products may point at the category
export const updateCategoryZodSchema = z
  .object({
    name: localizedName.partial(),
    image: fileRefZodSchema.nullable(),
    isFeatured: z.boolean(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

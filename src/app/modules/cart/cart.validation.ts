import { z } from "zod";

const addItemSchema = z.object({
  body: z.object({
    productId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Valid productId is required"),
    qty: z.number().int().min(1, "Quantity must be at least 1"),
  }),
});

const updateQtySchema = z.object({
  body: z.object({
    qty: z.number().int().min(0, "Quantity must be 0 or greater"),
  }),
});

export const CartValidations = {
  addItemSchema,
  updateQtySchema,
};

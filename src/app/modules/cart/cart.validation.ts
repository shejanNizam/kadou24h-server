import { z } from "zod";

const addItemSchema = z.object({
  body: z.object({
    productId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID"),
    qty: z.number().int().min(1, "NUMBER_TOO_LOW"),
  }),
});

const updateQtySchema = z.object({
  body: z.object({
    qty: z.number().int().min(0, "NUMBER_TOO_LOW"),
  }),
});

export const CartValidations = {
  addItemSchema,
  updateQtySchema,
};

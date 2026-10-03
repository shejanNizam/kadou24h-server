import { z } from "zod";
import { ReviewStatus } from "./review.interface";

const createReviewZodSchema = z.object({
  body: z.object({
    subOrderId: z.string().min(1, "Sub-order ID is required"),
    rating: z
      .number()
      .int()
      .min(1, "Rating must be between 1 and 5")
      .max(5, "Rating must be between 1 and 5"),
    comment: z.string().trim().optional(),
  }),
});

const updateReviewStatusZodSchema = z.object({
  body: z.object({
    status: z.nativeEnum(ReviewStatus),
  }),
});

export const ReviewValidations = {
  createReviewZodSchema,
  updateReviewStatusZodSchema,
};

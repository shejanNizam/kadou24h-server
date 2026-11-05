import { z } from "zod";
import { ReviewStatus } from "./review.interface";

const createReviewZodSchema = z.object({
  body: z.object({
    subOrderId: z.string().min(1, "FIELD_REQUIRED"),
    rating: z
      .number()
      .int()
      .min(1, "RATING_RANGE")
      .max(5, "RATING_RANGE"),
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

import z from "zod";
import { fileRefZodSchema, objectIdSchema } from "../../utils/commonSchemas";
import { BOOKING } from "./booking.constants";
import { WorkerReviewStatus } from "./booking.interface";

export const createBookingZodSchema = z.object({
  workerProfileId: objectIdSchema,
  scheduledAt: z.coerce.date({ error: "BOOKING_DATE_REQUIRED" }),
  addressId: objectIdSchema.optional(),
  description: z.string().trim().min(10, "BOOKING_DESCRIPTION_TOO_SHORT").max(1000),
  photos: z.array(fileRefZodSchema).max(BOOKING.maxPhotos).optional(),
});

export const declineBookingZodSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const cancelBookingZodSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const doneBookingZodSchema = z.object({
  /** The price agreed with the customer, for the worker's own "estimated earnings" */
  agreedPrice: z.number().int().min(0).max(1_000_000_000).optional(),
});

export const notDoneBookingZodSchema = z.object({
  note: z.string().trim().max(300).optional(),
});

export const createWorkerReviewZodSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
  photos: z.array(fileRefZodSchema).max(BOOKING.maxReviewPhotos).optional(),
});

export const adminCancelBookingZodSchema = z.object({
  reason: z.string().trim().min(3, "REASON_TOO_SHORT").max(300),
});

export const changeStrikeZodSchema = z.object({
  action: z.enum(["lift", "soften"]),
  note: z.string().trim().max(300).optional(),
});

export const setWorkerReviewStatusZodSchema = z.object({
  status: z.enum(WorkerReviewStatus),
});

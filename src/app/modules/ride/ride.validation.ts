import z from "zod";
import { fileRefZodSchema, latLngSchema } from "../../utils/commonSchemas";

const place = latLngSchema.extend({
  address: z.string().trim().min(2, "RIDE_ADDRESS_REQUIRED").max(200),
});

export const estimateRideZodSchema = z.object({
  pickup: latLngSchema,
  dropoff: latLngSchema,
});

export const requestRideZodSchema = z.object({
  pickup: place,
  dropoff: place,
  note: z.string().trim().max(200).optional(),
  pickupPhoto: fileRefZodSchema.optional(),
});

export const cancelRideZodSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const rateRideZodSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const adminCancelRideZodSchema = z.object({
  reason: z.string().trim().min(3, "REASON_TOO_SHORT").max(300),
});

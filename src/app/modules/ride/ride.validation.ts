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

/** Rider: my price (whole GNF; default the suggested fare) */
export const placeBidZodSchema = z.object({
  price: z.number().int({ message: "WHOLE_NUMBER" }).positive().optional(),
});

/** Passenger: my counter-offer (whole GNF) */
export const counterBidZodSchema = z.object({
  price: z.number().int({ message: "WHOLE_NUMBER" }).positive(),
});

/** Rider: my answer to the passenger's counter-offer */
export const answerCounterZodSchema = z.object({
  accept: z.boolean(),
});

export const adminCancelRideZodSchema = z.object({
  reason: z.string().trim().min(3, "REASON_TOO_SHORT").max(300),
});

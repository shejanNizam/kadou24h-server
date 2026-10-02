import z from "zod";
import { latLngSchema } from "../../utils/commonSchemas";

export const createTransitStationZodSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(60),
    region: z.string().trim().max(60).optional(),
    location: latLngSchema,
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateTransitStationZodSchema = createTransitStationZodSchema.partial().strict();

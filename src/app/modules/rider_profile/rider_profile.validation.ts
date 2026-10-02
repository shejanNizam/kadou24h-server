import z from "zod";
import { objectIdSchema } from "../../utils/commonSchemas";
import { documentInputZodSchema } from "../profile_common/profile.common";
import { PartnerType, RiderDocumentType, VehicleType } from "./rider_profile.interface";

const vehicleSchema = z
  .object({
    type: z.enum(Object.values(VehicleType) as [string, ...string[]]),
    color: z.string().trim().max(30),
    brand: z.string().trim().max(40),
    plateNumber: z.string().trim().max(20),
  })
  .partial();

const transitRouteSchema = z
  .object({ fromStationId: objectIdSchema, toStationId: objectIdSchema })
  .refine((r) => r.fromStationId !== r.toStationId, {
    message: "A route needs two different stations",
  });

// Draft — any subset; completeness is checked on submit
export const saveRiderApplicationZodSchema = z
  .object({
    partnerType: z.enum(Object.values(PartnerType) as [string, ...string[]]),
    vehicle: vehicleSchema,
    vestNumber: z.string().trim().max(20),
    cityArea: z.string().trim().min(2).max(80),
    nationalIdNumber: z.string().trim().min(4).max(40),
    transitRoutes: z.array(transitRouteSchema).max(20),
    documents: z
      .array(documentInputZodSchema(Object.values(RiderDocumentType) as [string, ...string[]]))
      .max(5),
  })
  .partial()
  .strict();

// After approval — identity (partner type, national id, documents) is locked
export const updateMyRiderProfileZodSchema = z
  .object({
    vehicle: vehicleSchema.omit({ type: true }),
    vestNumber: z.string().trim().max(20),
    cityArea: z.string().trim().min(2).max(80),
    transitRoutes: z.array(transitRouteSchema).max(20),
  })
  .partial()
  .strict();

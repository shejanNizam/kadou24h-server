import { z } from "zod";
import {
  DeliveryRateType,
  DeliveryVehicleType,
} from "./delivery_rate.interface";

const createLocalDeliveryRateSchema = z.object({
  body: z.object({
    type: z.literal(DeliveryRateType.local),
    city: z.string().min(1, "FIELD_REQUIRED"),
    vehicleType: z.nativeEnum(DeliveryVehicleType),
    baseFee: z.number().int().min(0, "NUMBER_TOO_LOW"),
    perKmFee: z.number().int().min(0, "NUMBER_TOO_LOW"),
    minFee: z.number().int().min(0, "NUMBER_TOO_LOW"),
    isActive: z.boolean().optional().default(true),
  }),
});

const createIntercityDeliveryRateSchema = z.object({
  body: z.object({
    type: z.literal(DeliveryRateType.intercity),
    fromStationId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID"),
    toStationId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID"),
    fee: z.number().int().min(0, "NUMBER_TOO_LOW"),
    estimatedHours: z
      .number()
      .int()
      .min(1, "NUMBER_TOO_LOW")
      .optional(),
    isActive: z.boolean().optional().default(true),
  }),
});

const createDeliveryRateSchema = z.discriminatedUnion("type", [
  createLocalDeliveryRateSchema.shape.body,
  createIntercityDeliveryRateSchema.shape.body,
]);

const updateDeliveryRateSchema = z.object({
  body: z.object({
    city: z.string().optional(),
    vehicleType: z.nativeEnum(DeliveryVehicleType).optional(),
    baseFee: z.number().int().min(0).optional(),
    perKmFee: z.number().int().min(0).optional(),
    minFee: z.number().int().min(0).optional(),
    fromStationId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    toStationId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    fee: z.number().int().min(0).optional(),
    estimatedHours: z.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
  }),
});

const calculateRateQuerySchema = z.object({
  query: z.object({
    type: z
      .nativeEnum(DeliveryRateType)
      .optional()
      .default(DeliveryRateType.local),
    vendorLat: z.string().transform(Number).optional(),
    vendorLng: z.string().transform(Number).optional(),
    customerLat: z.string().transform(Number).optional(),
    customerLng: z.string().transform(Number).optional(),
    city: z.string().optional(),
    vehicleType: z.nativeEnum(DeliveryVehicleType).optional(),
    fromStationId: z.string().optional(),
    toStationId: z.string().optional(),
  }),
});

export const DeliveryRateValidations = {
  createLocalDeliveryRateSchema,
  createIntercityDeliveryRateSchema,
  createDeliveryRateSchema,
  updateDeliveryRateSchema,
  calculateRateQuerySchema,
};

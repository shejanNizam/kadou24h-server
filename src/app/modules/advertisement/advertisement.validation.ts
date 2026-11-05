import { z } from "zod";
import { AdPlacement, AdStatus, AdType } from "./advertisement.interface";

const createAdZodSchema = z.object({
  body: z.object({
    name: z.string().min(2, "TEXT_TOO_SHORT"),
    advertiserName: z.string().min(2, "TEXT_TOO_SHORT"),
    type: z.nativeEnum(AdType).default(AdType.banner),
    placement: z.nativeEnum(AdPlacement),
    images: z.array(z.string().url()).min(1, "IMAGES_REQUIRED"),
    linkUrl: z.string().url().optional(),
    description: z.string().optional(),
    startAt: z.string().datetime().or(z.string()),
    endAt: z.string().datetime().or(z.string()),
    status: z.nativeEnum(AdStatus).default(AdStatus.active),
  }),
});

const updateAdZodSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    advertiserName: z.string().min(2).optional(),
    type: z.nativeEnum(AdType).optional(),
    placement: z.nativeEnum(AdPlacement).optional(),
    images: z.array(z.string().url()).min(1).optional(),
    linkUrl: z.string().url().optional(),
    description: z.string().optional(),
    startAt: z.string().datetime().or(z.string()).optional(),
    endAt: z.string().datetime().or(z.string()).optional(),
    status: z.nativeEnum(AdStatus).optional(),
  }),
});

export const AdvertisementValidations = {
  createAdZodSchema,
  updateAdZodSchema,
};

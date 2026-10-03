import { z } from "zod";
import { AdPlacement, AdStatus, AdType } from "./advertisement.interface";

const createAdZodSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    advertiserName: z.string().min(2, "Advertiser name is required"),
    type: z.nativeEnum(AdType).default(AdType.banner),
    placement: z.nativeEnum(AdPlacement),
    images: z.array(z.string().url()).min(1, "At least one image URL is required"),
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

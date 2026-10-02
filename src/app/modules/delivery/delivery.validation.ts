import { z } from "zod";

const assignRiderSchema = z.object({
  body: z.object({
    riderId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Valid riderId is required"),
  }),
});

const declineDeliverySchema = z.object({
  body: z.object({
    reason: z
      .string()
      .min(3, "Decline reason must be at least 3 characters"),
  }),
});

const verifyPinSchema = z.object({
  body: z.object({
    pin: z
      .string()
      .length(4, "PIN must be exactly 4 digits")
      .regex(/^\d{4}$/, "PIN must consist of numbers only"),
    proofPhoto: z
      .object({
        url: z.string().url(),
        publicId: z.string(),
      })
      .optional(),
  }),
});

const updateLocationSchema = z.object({
  body: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    heading: z.number().optional(),
  }),
});

const toggleOnlineSchema = z.object({
  body: z.object({
    isOnline: z.boolean(),
  }),
});

export const DeliveryValidations = {
  assignRiderSchema,
  declineDeliverySchema,
  verifyPinSchema,
  updateLocationSchema,
  toggleOnlineSchema,
};

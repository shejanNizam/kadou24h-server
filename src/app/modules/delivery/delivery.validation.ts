import { z } from "zod";

const assignRiderSchema = z.object({
  body: z.object({
    riderId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID"),
  }),
});

const declineDeliverySchema = z.object({
  body: z.object({
    reason: z
      .string()
      .min(3, "REASON_TOO_SHORT"),
  }),
});

const verifyPinSchema = z.object({
  body: z.object({
    pin: z
      .string()
      .length(4, "PIN_FORMAT")
      .regex(/^\d{4}$/, "PIN_FORMAT"),
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

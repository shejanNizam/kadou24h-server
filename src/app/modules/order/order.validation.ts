import { z } from "zod";
import {
  DeliveryType,
  PaymentMethod,
  SubOrderStatus,
} from "./order.interface";

const addressSnapshotSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  phone: z.string().min(1, "Phone is required"),
  city: z.string().min(1, "City is required"),
  commune: z.string().optional(),
  neighborhood: z.string().optional(),
  landmark: z.string().optional(),
  directions: z.string().optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  placePhoto: z
    .object({
      url: z.string().url(),
      publicId: z.string(),
    })
    .optional(),
});

const checkoutSummarySchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          productId: z.string().regex(/^[0-9a-fA-F]{24}$/),
          qty: z.number().int().min(1),
        }),
      )
      .optional(),
    addressId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional(),
    addressSnapshot: addressSnapshotSchema.optional(),
    deliveryType: z.nativeEnum(DeliveryType),
    destinationStationId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional(),
    specialInstructions: z.string().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod),
    couponCode: z.string().trim().max(30).optional(),
  }),
});

const placeOrderSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          productId: z.string().regex(/^[0-9a-fA-F]{24}$/),
          qty: z.number().int().min(1),
        }),
      )
      .optional(),
    addressId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional(),
    addressSnapshot: addressSnapshotSchema.optional(),
    deliveryType: z.nativeEnum(DeliveryType),
    destinationStationId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional(),
    specialInstructions: z.string().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod),
    couponCode: z.string().trim().max(30).optional(),
  }),
});

const vendorStatusUpdateSchema = z.object({
  body: z.object({
    status: z.enum([
      SubOrderStatus.accepted,
      SubOrderStatus.preparing,
      SubOrderStatus.ready_for_pickup,
    ]),
    note: z.string().optional(),
    estimatedDeliveryMinutes: z.number().int().min(1).optional(),
  }),
});

const vendorModifyOrderSchema = z.object({
  body: z.object({
    modifications: z
      .array(
        z.object({
          productId: z.string().regex(/^[0-9a-fA-F]{24}$/),
          action: z.enum(["remove", "update_qty"]),
          newQty: z.number().int().min(0).optional(),
        }),
      )
      .min(1, "At least one modification item is required"),
    reason: z.string().optional(),
  }),
});

const cancelOrderSchema = z.object({
  body: z.object({
    reason: z.string().min(3, "Cancellation reason must be at least 3 characters"),
  }),
});

export const OrderValidations = {
  checkoutSummarySchema,
  placeOrderSchema,
  vendorStatusUpdateSchema,
  vendorModifyOrderSchema,
  cancelOrderSchema,
};

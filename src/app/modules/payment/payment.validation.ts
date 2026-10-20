import z from "zod";
import {
  DisputeStatus,
  PaymentMethod,
  PaymentPurpose,
} from "./payment.interface";

export const initiatePaymentSchema = z.object({
  purpose: z.enum(Object.values(PaymentPurpose) as [string, ...string[]]),
  refId: z.string().min(1, "refId is required"),
  contextId: z.string().optional(),
  method: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
  provider: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const webhookSchema = z.object({
  idempotencyKey: z.string().optional(),
  providerRef: z.string().optional(),
  paymentId: z.string().optional(),
  status: z.enum(["success", "failed"]),
  // Amount the gateway actually collected (GNF) — must match the payment
  amount: z.number().int().min(0).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const devConfirmSchema = z.object({
  status: z.enum(["success", "failed"]),
});

export const issueRefundSchema = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Valid orderId is required"),
  subOrderId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Valid subOrderId is required")
    .optional(),
  amount: z.number().int().min(1, "Refund amount must be at least 1 GNF"),
  reason: z.string().trim().min(3, "Reason is required"),
  notes: z.string().optional(),
  transactionId: z.string().trim().max(100).optional(),
});

// Admin decides a pending refund request
export const processRefundSchema = z
  .object({
    status: z.enum(["completed", "rejected"]),
    // Approve less than requested (e.g. keep a delivery fee already spent)
    amount: z.number().int().min(1).optional(),
    transactionId: z.string().trim().max(100).optional(),
    rejectionReason: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== "rejected" || (v.rejectionReason?.length ?? 0) >= 3, {
    message: "Explain to the customer why the refund is rejected",
    path: ["rejectionReason"],
  });

export const createDisputeSchema = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Valid orderId is required"),
  subOrderId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Valid subOrderId is required")
    .optional(),
  amount: z.number().int().min(1).optional(),
  reason: z.string().trim().min(5, "Reason must be at least 5 characters"),
  notes: z.string().optional(),
});

export const resolveDisputeSchema = z.object({
  status: z.enum([DisputeStatus.resolved, DisputeStatus.rejected]),
  adminResolution: z.string().trim().min(3, "adminResolution is required"),
  notes: z.string().optional(),
  issueRefund: z.boolean().optional(),
  refundAmount: z.number().int().min(1).optional(),
});

import z from "zod";
import { objectIdSchema } from "../../utils/commonSchemas";

export const inviteRiderZodSchema = z.object({ riderId: objectIdSchema });

export const requestVendorZodSchema = z.object({ vendorId: objectIdSchema });

export const respondLinkZodSchema = z.object({
  accept: z.boolean(),
});

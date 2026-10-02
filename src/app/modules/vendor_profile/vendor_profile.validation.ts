import z from "zod";
import {
  fileRefZodSchema,
  latLngSchema,
  objectIdSchema,
  timeSchema,
} from "../../utils/commonSchemas";
import { documentInputZodSchema } from "../profile_common/profile.common";
import { emailSchema, phoneSchema } from "../user/user.validation";
import { VendorDocumentType, WeekDay } from "./vendor_profile.interface";

const storeFields = {
  storeName: z.string().trim().min(2).max(80),
  logo: fileRefZodSchema,
  businessCategoryId: objectIdSchema,
  marketName: z.string().trim().max(80),
  businessPhone: phoneSchema,
  businessEmail: emailSchema,
  address: z
    .object({
      text: z.string().trim().max(200),
      city: z.string().trim().min(2).max(60),
      country: z.string().length(2).toUpperCase(),
      location: latLngSchema,
    })
    .partial(),
};

// Draft — any subset; completeness is checked on submit
export const saveVendorApplicationZodSchema = z
  .object({
    ...storeFields,
    documents: z
      .array(documentInputZodSchema(Object.values(VendorDocumentType) as [string, ...string[]]))
      .max(5),
  })
  .partial()
  .strict();

// After approval — store details only (documents & category need re-review)
export const updateMyStoreZodSchema = z
  .object({
    storeName: storeFields.storeName,
    logo: storeFields.logo,
    marketName: storeFields.marketName,
    businessPhone: storeFields.businessPhone,
    businessEmail: storeFields.businessEmail,
    address: storeFields.address,
  })
  .partial()
  .strict();

export const updateAvailabilityZodSchema = z
  .object({
    isOpen: z.boolean(),
    availability: z
      .object({
        enabled: z.boolean(),
        days: z.array(z.enum(Object.values(WeekDay) as [string, ...string[]])).max(7),
        openTime: timeSchema,
        closeTime: timeSchema,
      })
      .partial(),
  })
  .partial()
  .strict();

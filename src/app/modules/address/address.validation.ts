import z from "zod";
import { fileRefZodSchema, latLngSchema } from "../../utils/commonSchemas";
import { AddressLabel } from "../user/user.interface";
import { nameSchema, phoneSchema } from "../user/user.validation";

const text = (max: number) => z.string().trim().max(max);

const addressFields = {
  label: z.enum(Object.values(AddressLabel) as [string, ...string[]]),
  customLabel: text(30),
  fullName: nameSchema,
  phone: phoneSchema,
  region: text(60),
  city: text(60).min(2, { message: "TEXT_TOO_SHORT" }),
  commune: text(60),
  // Mandatory (client, 2026-11-24): riders and workers find the customer by their quartier
  neighborhood: text(80).min(2, { message: "TEXT_TOO_SHORT" }),
  landmark: text(200),
  directions: text(500),
  location: latLngSchema,
  placePhoto: fileRefZodSchema,
  isDefault: z.boolean(),
};

export const createAddressZodSchema = z
  .object(addressFields)
  .partial()
  .required({ fullName: true, phone: true, city: true, neighborhood: true, location: true })
  .strict();

export const updateAddressZodSchema = z.object(addressFields).partial().strict();

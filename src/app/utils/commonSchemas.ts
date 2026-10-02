import { Schema, Types } from "mongoose";
import z from "zod";
import { IGeoPoint, ILatLng } from "../interfaces/common.types";

// ──────────────────────────────
// Mongoose sub-schemas
// ──────────────────────────────

export const geoPointSchema = new Schema<IGeoPoint>(
  {
    type: { type: String, enum: ["Point"], default: "Point", required: true },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
);

export const fileRefSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
  },
  { _id: false },
);

export const toGeoPoint = ({ lat, lng }: ILatLng): IGeoPoint => ({
  type: "Point",
  coordinates: [lng, lat],
});

export const fromGeoPoint = (point?: IGeoPoint): ILatLng | undefined =>
  point ? { lat: point.coordinates[1], lng: point.coordinates[0] } : undefined;

// ──────────────────────────────
// Zod schemas
// ──────────────────────────────

export const objectIdSchema = z
  .string({ error: "Id must be a string" })
  .refine((v) => Types.ObjectId.isValid(v), { message: "Invalid id" });

export const latLngSchema = z.object({
  lat: z.number({ error: "lat must be a number" }).min(-90).max(90),
  lng: z.number({ error: "lng must be a number" }).min(-180).max(180),
});

export const fileRefZodSchema = z.object({
  url: z.string().url({ message: "File url must be a valid URL" }),
  publicId: z.string().default(""),
});

// HH:mm, 24h
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Time must be HH:mm (24h)" });

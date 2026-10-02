import { model, Schema } from "mongoose";
import { geoPointSchema } from "../../utils/commonSchemas";
import { ITransitStation } from "./transit_station.interface";

const transitStationSchema = new Schema<ITransitStation>(
  {
    name: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    region: { type: String, trim: true },
    location: { type: geoPointSchema, required: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

transitStationSchema.index({ city: 1, isActive: 1 });
transitStationSchema.index({ location: "2dsphere" });

export const TransitStation = model<ITransitStation>("TransitStation", transitStationSchema);

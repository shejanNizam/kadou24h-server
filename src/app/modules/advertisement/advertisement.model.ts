import { model, Schema } from "mongoose";
import {
  AdPlacement,
  AdStatus,
  AdType,
  IAdvertisement,
} from "./advertisement.interface";

export const advertisementSchema = new Schema<IAdvertisement>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    advertiserName: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: Object.values(AdType),
      default: AdType.banner,
      required: true,
    },
    placement: {
      type: String,
      enum: Object.values(AdPlacement),
      required: true,
    },
    images: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length > 0,
        message: "At least one image is required for the advertisement.",
      },
    },
    linkUrl: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    startAt: {
      type: Date,
      required: true,
    },
    endAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(AdStatus),
      default: AdStatus.draft,
      required: true,
    },
    impressions: {
      type: Number,
      default: 0,
      min: 0,
    },
    clicks: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

advertisementSchema.index({ placement: 1, status: 1, startAt: 1, endAt: 1 });
advertisementSchema.index({ createdAt: -1 });

export const Advertisement = model<IAdvertisement>("Advertisement", advertisementSchema);

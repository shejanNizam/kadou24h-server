import { model, Schema } from "mongoose";
import { fileRefSchema, geoPointSchema } from "../../utils/commonSchemas";
import { reviewFields, verificationDocumentSchema } from "../profile_common/profile.common";
import { IVendorProfile, VendorDocumentType, WeekDay } from "./vendor_profile.interface";

const vendorProfileSchema = new Schema<IVendorProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    isPlatformStore: { type: Boolean, default: false },
    storeName: { type: String, trim: true },
    logo: { type: fileRefSchema },
    businessCategoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    marketName: { type: String, trim: true },
    businessPhone: { type: String, trim: true },
    businessEmail: { type: String, trim: true, lowercase: true },
    address: {
      text: { type: String, trim: true },
      city: { type: String, trim: true },
      country: { type: String, default: "GN" },
      location: { type: geoPointSchema },
    },
    documents: {
      type: [verificationDocumentSchema(Object.values(VendorDocumentType))],
      default: [],
    },
    isOpen: { type: Boolean, default: false },
    availability: {
      enabled: { type: Boolean, default: true },
      days: {
        type: [String],
        enum: Object.values(WeekDay),
        default: [WeekDay.mon, WeekDay.tue, WeekDay.wed, WeekDay.thu, WeekDay.fri, WeekDay.sat],
      },
      openTime: { type: String, default: "08:00" },
      closeTime: { type: String, default: "20:00" },
    },
    stats: {
      ratingAvg: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
      totalOrders: { type: Number, default: 0 },
      totalProducts: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
    },
    ...reviewFields,
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

vendorProfileSchema.index({ approvalStatus: 1, createdAt: -1 });
vendorProfileSchema.index({ "address.location": "2dsphere" });
vendorProfileSchema.index({ storeName: "text", marketName: "text" });

export const VendorProfile = model<IVendorProfile>("VendorProfile", vendorProfileSchema);

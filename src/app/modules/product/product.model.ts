import { model, Schema } from "mongoose";
import { fileRefSchema, geoPointSchema } from "../../utils/commonSchemas";
import { IProduct, ProductApprovalStatus } from "./product.interface";

const productSchema = new Schema<IProduct>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "VendorProfile", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, min: 0 },
    images: { type: [fileRefSchema], default: [] },
    features: { type: [String], default: [] },
    inTheBox: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    stockQty: { type: Number, required: true, default: 0, min: 0 },
    minStockAlert: { type: Number, default: 0, min: 0 },
    prepTimeMinutes: { type: Number, default: 15, min: 0 },
    isAvailable: { type: Boolean, default: true },
    approvalStatus: {
      type: String,
      enum: Object.values(ProductApprovalStatus),
      default: ProductApprovalStatus.pending,
    },
    adminReviewNote: { type: String, trim: true },
    vendorLocation: { type: geoPointSchema },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    soldCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

productSchema.index({ vendorId: 1, isDeleted: 1 });
productSchema.index({ approvalStatus: 1, isDeleted: 1 });
productSchema.index({ categoryId: 1, isDeleted: 1 });
productSchema.index({ subcategoryId: 1, isDeleted: 1 });
productSchema.index({ slug: 1, isDeleted: 1 });
productSchema.index({ vendorLocation: "2dsphere" });
productSchema.index({ name: "text", description: "text" });

export const Product = model<IProduct>("Product", productSchema);

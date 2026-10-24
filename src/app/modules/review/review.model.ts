import { model, Schema } from "mongoose";
import { IReview, ReviewStatus } from "./review.interface";

export const reviewSchema = new Schema<IReview>(
  {
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subOrderId: {
      type: Schema.Types.ObjectId,
      ref: "sub_orders",
      required: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "VendorProfile",
      required: true,
      index: true,
    },
    productIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    riderId: {
      type: Schema.Types.ObjectId,
      ref: "RiderProfile",
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(ReviewStatus),
      default: ReviewStatus.visible,
      required: true,
    },
    reportCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    reportedBy: { type: [Schema.Types.ObjectId], ref: "User", default: [], select: false },
  },
  {
    timestamps: true,
  },
);

reviewSchema.index({ authorId: 1, subOrderId: 1 }, { unique: true });
reviewSchema.index({ vendorId: 1, status: 1 });
reviewSchema.index({ productIds: 1, status: 1 });
reviewSchema.index({ riderId: 1, status: 1 });
reviewSchema.index({ createdAt: -1 });

export const Review = model<IReview>("Review", reviewSchema);

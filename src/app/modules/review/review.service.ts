import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { Delivery } from "../delivery/delivery.model";
import { Order } from "../order/order.model";
import { SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { Product } from "../product/product.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { IReview, ReviewStatus } from "./review.interface";
import { Review } from "./review.model";

interface ICreateReviewPayload {
  subOrderId: string;
  rating: number;
  comment?: string;
}

/** Recalculates and updates the average rating and count for a vendor */
const recomputeVendorRating = async (vendorId: Types.ObjectId) => {
  const result = await Review.aggregate([
    { $match: { vendorId, status: ReviewStatus.visible } },
    {
      $group: {
        _id: null,
        avg: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const ratingAvg = result[0]?.avg ? Math.round(result[0].avg * 10) / 10 : 0;
  const ratingCount = result[0]?.count || 0;

  await VendorProfile.findByIdAndUpdate(vendorId, {
    "stats.ratingAvg": ratingAvg,
    "stats.ratingCount": ratingCount,
  });
};

/** Recalculates and updates the average rating and count for a product */
const recomputeProductRating = async (productId: Types.ObjectId) => {
  const result = await Review.aggregate([
    { $match: { productIds: productId, status: ReviewStatus.visible } },
    {
      $group: {
        _id: null,
        avg: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const ratingAvg = result[0]?.avg ? Math.round(result[0].avg * 10) / 10 : 0;
  const ratingCount = result[0]?.count || 0;

  await Product.findByIdAndUpdate(productId, {
    ratingAvg,
    ratingCount,
  });
};

const createReview = async (
  authorId: string,
  payload: ICreateReviewPayload,
): Promise<IReview> => {
  // 1. Fetch sub-order
  const subOrder = await SubOrder.findById(payload.subOrderId);
  if (!subOrder) {
    throw new AppError(404, "SUB_ORDER_NOT_FOUND");
  }

  // 2. Fetch parent order to verify ownership
  const order = await Order.findById(subOrder.orderId);
  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND");
  }

  if (order.customerId.toString() !== authorId.toString()) {
    throw new AppError(403, "REVIEW_NOT_YOUR_ORDER");
  }

  // 3. Ensure sub-order has been delivered
  if (subOrder.status !== SubOrderStatus.delivered) {
    throw new AppError(400, "REVIEW_NOT_DELIVERED");
  }

  // 4. Ensure no duplicate review for this sub-order by the same customer
  const existingReview = await Review.findOne({
    authorId: new Types.ObjectId(authorId),
    subOrderId: subOrder._id,
  });

  if (existingReview) {
    throw new AppError(400, "ORDER_ALREADY_REVIEWED");
  }

  // 5. Extract products and rider if assigned
  const productIds = subOrder.items.map((item) => item.productId);
  const delivery = await Delivery.findOne({ subOrderId: subOrder._id });

  // 6. Create review
  const review = await Review.create({
    authorId: new Types.ObjectId(authorId),
    subOrderId: subOrder._id,
    vendorId: subOrder.vendorId,
    productIds,
    riderId: delivery?.riderId,
    rating: payload.rating,
    comment: payload.comment,
    status: ReviewStatus.visible,
    reportCount: 0,
  });

  // 7. Recompute vendor and product ratings in background/sequentially
  await recomputeVendorRating(subOrder.vendorId);
  for (const pid of productIds) {
    await recomputeProductRating(pid);
  }

  const populated = await Review.findById(review._id).populate(
    "authorId",
    "name avatar",
  );

  return populated || review;
};

const getVendorReviews = async (
  vendorId: string,
  query: { page?: number; limit?: number },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = {
    vendorId: new Types.ObjectId(vendorId),
    status: ReviewStatus.visible,
  };

  const [data, total] = await Promise.all([
    Review.find(filter)
      .populate("authorId", "name avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const getProductReviews = async (
  productId: string,
  query: { page?: number; limit?: number },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = {
    productIds: new Types.ObjectId(productId),
    status: ReviewStatus.visible,
  };

  const [data, total] = await Promise.all([
    Review.find(filter)
      .populate("authorId", "name avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const getMyReviews = async (
  authorId: string,
  query: { page?: number; limit?: number },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { authorId: new Types.ObjectId(authorId) };

  const [data, total] = await Promise.all([
    Review.find(filter)
      .populate("vendorId", "storeName logo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const reportReview = async (reviewId: string, userId: string) => {
  if (!Types.ObjectId.isValid(reviewId)) throw new AppError(404, "REVIEW_NOT_FOUND");
  // Counted once per person
  const review =
    (await Review.findOneAndUpdate(
      { _id: reviewId, reportedBy: { $ne: new Types.ObjectId(userId) } },
      { $inc: { reportCount: 1 }, $addToSet: { reportedBy: new Types.ObjectId(userId) } },
      { returnDocument: "after" },
    )) ?? (await Review.findById(reviewId));

  if (!review) {
    throw new AppError(404, "REVIEW_NOT_FOUND");
  }

  return {
    success: true,
    reportCount: review.reportCount,
  };
};

const updateReviewStatusAdmin = async (
  adminId: string,
  reviewId: string,
  status: ReviewStatus,
): Promise<IReview> => {
  const review = await Review.findById(reviewId);
  if (!review) {
    throw new AppError(404, "REVIEW_NOT_FOUND");
  }

  const before = { status: review.status };
  review.status = status;
  await review.save();

  // Recompute ratings
  await recomputeVendorRating(review.vendorId);
  for (const pid of review.productIds) {
    await recomputeProductRating(pid);
  }

  await AuditLogServices.record({
    actorId: adminId,
    action: "review.status_update",
    targetType: "review",
    targetId: review._id.toString(),
    before,
    after: { status: review.status },
  });

  return review;
};

export const ReviewServices = {
  createReview,
  getVendorReviews,
  getProductReviews,
  getMyReviews,
  reportReview,
  updateReviewStatusAdmin,
};

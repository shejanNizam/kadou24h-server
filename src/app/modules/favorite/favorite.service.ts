import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Product } from "../product/product.model";
import { Favorite } from "./favorite.model";

const toggleFavorite = async (userId: string, productId: string) => {
  if (!Types.ObjectId.isValid(productId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "INVALID_ID");
  }

  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND");
  }

  const existing = await Favorite.findOne({ userId, productId });

  if (existing) {
    await Favorite.findByIdAndDelete(existing._id);
    return {
      isFavorite: false,
      productId,
      message: "Removed from favorites successfully.",
    };
  }

  await Favorite.create({ userId, productId });
  return {
    isFavorite: true,
    productId,
    message: "Added to favorites successfully.",
  };
};

const getMyFavorites = async (
  userId: string,
  query: { page?: string; limit?: string },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const [favorites, total] = await Promise.all([
    Favorite.find({ userId })
      .populate({
        path: "productId",
        match: { isDeleted: false },
        populate: [
          { path: "vendorId", select: "storeName logo address isOpen stats" },
          { path: "categoryId", select: "name slug" },
        ],
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Favorite.countDocuments({ userId }),
  ]);

  // Filter out any favorites whose product was deleted
  const items = favorites
    .filter((f) => f.productId != null)
    .map((f) => f.productId);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: items,
  };
};

const checkIsFavorite = async (userId: string, productId: string): Promise<boolean> => {
  if (!Types.ObjectId.isValid(productId)) return false;
  const count = await Favorite.countDocuments({ userId, productId });
  return count > 0;
};

export const FavoriteServices = {
  toggleFavorite,
  getMyFavorites,
  checkIsFavorite,
};

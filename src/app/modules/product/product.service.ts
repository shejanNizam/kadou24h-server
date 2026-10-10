import httpStatus from "http-status";
import { QueryFilter, Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Category } from "../category/category.model";
import { Favorite } from "../favorite/favorite.model";
import { ApprovalStatus } from "../profile_common/profile.common";
import { ADMIN_ROLES } from "../user/user.interface";

const isAdminRole = (roles: string[]) =>
  roles.some((r) => (ADMIN_ROLES as string[]).includes(r));
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { IProduct, IProductFilterQuery, ProductApprovalStatus } from "./product.interface";
import { Product } from "./product.model";
import { containsRegex } from "../../utils/queryParams";

const generateSlug = (name: string): string => {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).substring(2, 7);
  return `${base || "product"}-${suffix}`;
};

const createProduct = async (
  payload: Partial<IProduct>,
  userId: string,
  userRoles: string[],
): Promise<IProduct> => {
  const isAdmin = isAdminRole(userRoles);
  let vendorProfile;

  if (isAdmin) {
    if (payload.vendorId) {
      vendorProfile = await VendorProfile.findById(payload.vendorId);
      if (!vendorProfile) {
        throw new AppError(httpStatus.NOT_FOUND, "Specified vendor profile not found.");
      }
    } else {
      // Use or find platform store
      vendorProfile = await VendorProfile.findOne({ isPlatformStore: true });
      if (!vendorProfile) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "No vendorId provided and no platform store exists. Please specify vendorId.",
        );
      }
    }
  } else {
    // Regular vendor flow
    vendorProfile = await VendorProfile.findOne({ userId });
    if (!vendorProfile) {
      throw new AppError(httpStatus.FORBIDDEN, "You do not have a vendor profile.");
    }
    if (vendorProfile.approvalStatus !== ApprovalStatus.approved) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        `Vendor profile is ${vendorProfile.approvalStatus}. You cannot publish products until approved.`,
      );
    }
  }

  // Validate category
  const category = await Category.findById(payload.categoryId);
  if (!category || !category.isActive) {
    throw new AppError(httpStatus.BAD_REQUEST, "Valid active category is required.");
  }

  if (payload.subcategoryId) {
    const subcategory = await Category.findOne({
      _id: payload.subcategoryId,
      parentId: payload.categoryId,
      isActive: true,
    });
    if (!subcategory) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Subcategory must belong to the selected category and be active.",
      );
    }
  }

  const slug = generateSlug(payload.name || "item");

  const productData: Partial<IProduct> = {
    ...payload,
    vendorId: vendorProfile._id,
    slug,
    vendorLocation: vendorProfile.address?.location,
    approvalStatus: isAdmin ? ProductApprovalStatus.approved : ProductApprovalStatus.pending,
    createdBy: new Types.ObjectId(userId),
    isDeleted: false,
  };

  const product = await Product.create(productData);

  // Update totalProducts stats on vendor profile
  await VendorProfile.findByIdAndUpdate(vendorProfile._id, {
    $inc: { "stats.totalProducts": 1 },
  });

  return product;
};

const updateProduct = async (
  productId: string,
  payload: Partial<IProduct>,
  userId: string,
  userRoles: string[],
): Promise<IProduct> => {
  const isAdmin = isAdminRole(userRoles);
  const product = await Product.findOne({ _id: productId, isDeleted: false });

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found.");
  }

  if (!isAdmin) {
    const vendorProfile = await VendorProfile.findOne({ userId });
    if (!vendorProfile || String(product.vendorId) !== String(vendorProfile._id)) {
      throw new AppError(httpStatus.FORBIDDEN, "You can only edit products belonging to your store.");
    }
  }

  if (payload.categoryId) {
    const category = await Category.findById(payload.categoryId);
    if (!category || !category.isActive) {
      throw new AppError(httpStatus.BAD_REQUEST, "Valid category is required.");
    }
  }

  if (payload.subcategoryId) {
    const parentId = payload.categoryId || product.categoryId;
    const subcategory = await Category.findOne({
      _id: payload.subcategoryId,
      parentId,
      isActive: true,
    });
    if (!subcategory) {
      throw new AppError(httpStatus.BAD_REQUEST, "Subcategory must belong to the selected category.");
    }
  }

  if (payload.name && payload.name !== product.name) {
    payload.slug = generateSlug(payload.name);
  }

  const updatedProduct = await Product.findByIdAndUpdate(productId, payload, {
    new: true,
    runValidators: true,
  });

  if (!updatedProduct) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found after update.");
  }

  return updatedProduct;
};

const updateProductStock = async (
  productId: string,
  payload: { stockQty?: number; minStockAlert?: number; isAvailable?: boolean },
  userId: string,
  userRoles: string[],
): Promise<IProduct> => {
  return updateProduct(productId, payload as Partial<IProduct>, userId, userRoles);
};

const deleteProduct = async (
  productId: string,
  userId: string,
  userRoles: string[],
): Promise<void> => {
  const isAdmin = isAdminRole(userRoles);
  const product = await Product.findOne({ _id: productId, isDeleted: false });

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found.");
  }

  if (!isAdmin) {
    const vendorProfile = await VendorProfile.findOne({ userId });
    if (!vendorProfile || String(product.vendorId) !== String(vendorProfile._id)) {
      throw new AppError(httpStatus.FORBIDDEN, "You can only delete products belonging to your store.");
    }
  }

  await Product.findByIdAndUpdate(productId, {
    isDeleted: true,
    deletedAt: new Date(),
  });

  // Decrement total products count
  await VendorProfile.findByIdAndUpdate(product.vendorId, {
    $inc: { "stats.totalProducts": -1 },
  });
};

const reviewProductApproval = async (
  productId: string,
  payload: { approvalStatus: ProductApprovalStatus; adminReviewNote?: string },
): Promise<IProduct> => {
  const product = await Product.findOne({ _id: productId, isDeleted: false });
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found.");
  }

  product.approvalStatus = payload.approvalStatus;
  if (payload.adminReviewNote !== undefined) {
    product.adminReviewNote = payload.adminReviewNote;
  }
  await product.save();

  return product;
};

const getProductByIdOrSlug = async (
  identifier: string,
  currentUserId?: string,
): Promise<{ product: IProduct; isFavorite: boolean }> => {
  const isObjectId = Types.ObjectId.isValid(identifier);
  const query = isObjectId ? { _id: identifier, isDeleted: false } : { slug: identifier, isDeleted: false };

  const product = await Product.findOne(query)
    .populate({
      path: "vendorId",
      select: "storeName logo address isOpen stats isPlatformStore marketName businessPhone",
    })
    .populate("categoryId", "name slug icon isFeatured")
    .populate("subcategoryId", "name slug");

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found.");
  }

  let isFavorite = false;
  if (currentUserId && Types.ObjectId.isValid(currentUserId)) {
    const fav = await Favorite.exists({ userId: currentUserId, productId: product._id });
    isFavorite = !!fav;
  }

  return { product, isFavorite };
};

const getPublicProducts = async (filters: IProductFilterQuery) => {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(filters.limit) || 10));
  const skip = (page - 1) * limit;

  const conditions: QueryFilter<IProduct> = {
    isDeleted: false,
    approvalStatus: ProductApprovalStatus.approved,
  };

  if (filters.category && Types.ObjectId.isValid(filters.category)) {
    conditions.categoryId = new Types.ObjectId(filters.category);
  }

  if (filters.subcategory && Types.ObjectId.isValid(filters.subcategory)) {
    conditions.subcategoryId = new Types.ObjectId(filters.subcategory);
  }

  if (filters.vendorId && Types.ObjectId.isValid(filters.vendorId)) {
    conditions.vendorId = new Types.ObjectId(filters.vendorId);
  }

  if (filters.inStock === "true") {
    conditions.stockQty = { $gt: 0 };
    conditions.isAvailable = true;
  }

  if (filters.rating) {
    const minRating = Number(filters.rating);
    if (!isNaN(minRating)) {
      conditions.ratingAvg = { $gte: minRating };
    }
  }

  if (filters.minPrice || filters.maxPrice) {
    conditions.price = {};
    if (filters.minPrice) conditions.price.$gte = Number(filters.minPrice);
    if (filters.maxPrice) conditions.price.$lte = Number(filters.maxPrice);
  }

  if (filters.tags) {
    const tagsArr = filters.tags.split(",").map((t) => t.trim().toLowerCase());
    conditions.tags = { $in: tagsArr };
  }

  if (filters.searchTerm) {
    const searchRegex = containsRegex(filters.searchTerm);
    conditions.$or = [{ name: searchRegex }, { description: searchRegex }, { tags: searchRegex }];
  }

  // Distance filter (if lat, lng, and maxDistance provided)
  if (filters.lat && filters.lng && filters.maxDistance) {
    const lat = Number(filters.lat);
    const lng = Number(filters.lng);
    const maxDistanceKm = Number(filters.maxDistance);

    if (!isNaN(lat) && !isNaN(lng) && !isNaN(maxDistanceKm) && maxDistanceKm > 0) {
      // 6378.1 km is Earth radius
      const radiusInRadians = maxDistanceKm / 6378.1;
      conditions.vendorLocation = {
        $geoWithin: {
          $centerSphere: [[lng, lat], radiusInRadians],
        },
      };
    }
  }

  // Sorting
  let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
  if (filters.sort === "price_asc") {
    sortOption = { price: 1 };
  } else if (filters.sort === "price_desc") {
    sortOption = { price: -1 };
  } else if (filters.sort === "rating") {
    sortOption = { ratingAvg: -1, ratingCount: -1 };
  } else if (filters.sort === "popular") {
    sortOption = { soldCount: -1, ratingCount: -1 };
  } else if (filters.sort === "newest") {
    sortOption = { createdAt: -1 };
  }

  const [products, total] = await Promise.all([
    Product.find(conditions)
      .populate("vendorId", "storeName logo address.city isOpen isPlatformStore stats.ratingAvg")
      .populate("categoryId", "name slug")
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(conditions),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: products,
  };
};

const getVendorProducts = async (
  userId: string,
  query: { statusTab?: "all" | "active" | "out_of_stock"; page?: string; limit?: string },
) => {
  const vendorProfile = await VendorProfile.findOne({ userId });
  if (!vendorProfile) {
    throw new AppError(httpStatus.FORBIDDEN, "Vendor profile not found.");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const conditions: QueryFilter<IProduct> = {
    vendorId: vendorProfile._id,
    isDeleted: false,
  };

  if (query.statusTab === "active") {
    conditions.isAvailable = true;
    conditions.stockQty = { $gt: 0 };
    conditions.approvalStatus = ProductApprovalStatus.approved;
  } else if (query.statusTab === "out_of_stock") {
    conditions.$or = [{ stockQty: 0 }, { isAvailable: false }];
  }

  const [products, total] = await Promise.all([
    Product.find(conditions)
      .populate("categoryId", "name slug")
      .populate("subcategoryId", "name slug")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(conditions),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: products,
  };
};

const getAdminProducts = async (query: Record<string, string>) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const conditions: QueryFilter<IProduct> = { isDeleted: false };

  if (query.vendorId && Types.ObjectId.isValid(query.vendorId)) {
    conditions.vendorId = new Types.ObjectId(query.vendorId);
  }
  const approvalStatus = Object.values(ProductApprovalStatus).find(
    (s) => s === query.approvalStatus,
  );
  if (approvalStatus) {
    conditions.approvalStatus = approvalStatus;
  }
  if (query.categoryId && Types.ObjectId.isValid(query.categoryId)) {
    conditions.categoryId = new Types.ObjectId(query.categoryId);
  }
  if (query.searchTerm) {
    const searchRegex = containsRegex(query.searchTerm);
    conditions.$or = [{ name: searchRegex }, { description: searchRegex }];
  }

  const [products, total, totalAll, totalActive, totalPending, totalOutOfStock] = await Promise.all([
    Product.find(conditions)
      .populate("vendorId", "storeName logo isPlatformStore")
      .populate("categoryId", "name slug")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(conditions),
    Product.countDocuments({ isDeleted: false }),
    Product.countDocuments({ isDeleted: false, approvalStatus: ProductApprovalStatus.approved, stockQty: { $gt: 0 } }),
    Product.countDocuments({ isDeleted: false, approvalStatus: ProductApprovalStatus.pending }),
    Product.countDocuments({ isDeleted: false, stockQty: 0 }),
  ]);

  return {
    summary: {
      total: totalAll,
      active: totalActive,
      pending: totalPending,
      outOfStock: totalOutOfStock,
    },
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: products,
  };
};

export const ProductServices = {
  createProduct,
  updateProduct,
  updateProductStock,
  deleteProduct,
  reviewProductApproval,
  getProductByIdOrSlug,
  getPublicProducts,
  getVendorProducts,
  getAdminProducts,
};

import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Product } from "../product/product.model";
import { ProductApprovalStatus } from "../product/product.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { SubOrder } from "../order/sub_order.model";
import { SubOrderStatus } from "../order/order.interface";
import {
  ICartItemPopulated,
  ICartResponse,
  IVendorCartGroup,
} from "./cart.interface";
import { Cart } from "./cart.model";

const getMyCart = async (userId: string): Promise<ICartResponse> => {
  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({ userId, items: [] });
  }

  if (cart.items.length === 0) {
    return {
      _id: String(cart._id),
      userId,
      totalItems: 0,
      subtotal: 0,
      groupedByVendor: [],
      unavailableItems: [],
    };
  }

  const productIds = cart.items.map((i) => i.productId);
  const products = await Product.find({
    _id: { $in: productIds },
    isDeleted: false,
  });
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const vendorIds = [
    ...new Set(
      products
        .map((p) => String(p.vendorId))
        .concat(cart.items.map((i) => String(i.vendorId))),
    ),
  ];
  const vendors = await VendorProfile.find({ _id: { $in: vendorIds } });
  const vendorMap = new Map(vendors.map((v) => [String(v._id), v]));

  const availableItems: ICartItemPopulated[] = [];
  const unavailableItems: ICartItemPopulated[] = [];

  for (const item of cart.items) {
    const pId = String(item.productId);
    const product = productMap.get(pId);

    if (
      !product ||
      product.approvalStatus !== ProductApprovalStatus.approved ||
      !product.isAvailable ||
      product.stockQty <= 0
    ) {
      unavailableItems.push({
        _id: String(item._id),
        productId: pId,
        name: product?.name || "Product Unavailable",
        slug: product?.slug || "",
        image: product?.images?.[0]?.url,
        price: product?.price || 0,
        discountPrice: product?.discountPrice,
        effectivePrice: product?.discountPrice ?? product?.price ?? 0,
        stockQty: product?.stockQty ?? 0,
        isAvailable: false,
        prepTimeMinutes: product?.prepTimeMinutes,
        vendorId: String(item.vendorId),
        qty: item.qty,
        lineTotal: 0,
      });
      continue;
    }

    const effectivePrice = product.discountPrice ?? product.price;
    const isStockSufficient = product.stockQty >= item.qty;

    if (!isStockSufficient) {
      unavailableItems.push({
        _id: String(item._id),
        productId: pId,
        name: product.name,
        slug: product.slug,
        image: product.images?.[0]?.url,
        price: product.price,
        discountPrice: product.discountPrice,
        effectivePrice,
        stockQty: product.stockQty,
        isAvailable: true,
        prepTimeMinutes: product.prepTimeMinutes,
        vendorId: String(product.vendorId),
        qty: item.qty,
        lineTotal: effectivePrice * item.qty,
      });
      continue;
    }

    availableItems.push({
      _id: String(item._id),
      productId: pId,
      name: product.name,
      slug: product.slug,
      image: product.images?.[0]?.url,
      price: product.price,
      discountPrice: product.discountPrice,
      effectivePrice,
      stockQty: product.stockQty,
      isAvailable: true,
      prepTimeMinutes: product.prepTimeMinutes,
      vendorId: String(product.vendorId),
      qty: item.qty,
      lineTotal: effectivePrice * item.qty,
    });
  }

  // Group available items by vendor
  const vendorGroupsMap = new Map<string, IVendorCartGroup>();

  for (const item of availableItems) {
    const vId = item.vendorId;
    let group = vendorGroupsMap.get(vId);

    if (!group) {
      const vendor = vendorMap.get(vId);
      group = {
        vendorId: vId,
        storeName: vendor?.storeName || "Unknown Vendor",
        logo: vendor?.logo?.url,
        isOpen: vendor?.isOpen ?? true,
        city: vendor?.address?.city,
        location: vendor?.address?.location?.coordinates,
        items: [],
        subtotal: 0,
        itemCount: 0,
      };
      vendorGroupsMap.set(vId, group);
    }

    group.items.push(item);
    group.subtotal += item.lineTotal;
    group.itemCount += item.qty;
  }

  const groupedByVendor = Array.from(vendorGroupsMap.values());
  const totalItems = availableItems.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = availableItems.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    _id: String(cart._id),
    userId,
    totalItems,
    subtotal,
    groupedByVendor,
    unavailableItems,
  };
};

const addToCart = async (userId: string, productId: string, qty: number) => {
  const product = await Product.findOne({
    _id: productId,
    isDeleted: false,
  });

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }

  if (product.approvalStatus !== ProductApprovalStatus.approved) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Product is not approved for sale",
    );
  }

  if (!product.isAvailable || product.stockQty <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Product is currently out of stock",
    );
  }

  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = new Cart({ userId, items: [] });
  }

  const existingItemIndex = cart.items.findIndex(
    (i) => String(i.productId) === productId,
  );

  if (existingItemIndex > -1) {
    const newQty = cart.items[existingItemIndex].qty + qty;
    if (newQty > product.stockQty) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Cannot add ${qty} more. Only ${product.stockQty} item(s) available in stock.`,
      );
    }
    cart.items[existingItemIndex].qty = newQty;
  } else {
    if (qty > product.stockQty) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Only ${product.stockQty} item(s) available in stock`,
      );
    }
    cart.items.push({
      productId: product._id,
      vendorId: product.vendorId,
      qty,
    });
  }

  await cart.save();
  return getMyCart(userId);
};

const updateItemQty = async (
  userId: string,
  productId: string,
  qty: number,
) => {
  const cart = await Cart.findOne({ userId });
  if (!cart) {
    throw new AppError(httpStatus.NOT_FOUND, "Cart not found");
  }

  const existingItemIndex = cart.items.findIndex(
    (i) => String(i.productId) === productId,
  );

  if (existingItemIndex === -1) {
    throw new AppError(httpStatus.NOT_FOUND, "Item not found in cart");
  }

  if (qty <= 0) {
    cart.items.splice(existingItemIndex, 1);
  } else {
    const product = await Product.findOne({
      _id: productId,
      isDeleted: false,
    });

    if (!product) {
      throw new AppError(httpStatus.NOT_FOUND, "Product not found");
    }

    if (qty > product.stockQty) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Only ${product.stockQty} item(s) available in stock`,
      );
    }

    cart.items[existingItemIndex].qty = qty;
  }

  await cart.save();
  return getMyCart(userId);
};

const removeItem = async (userId: string, productId: string) => {
  const cart = await Cart.findOne({ userId });
  if (!cart) {
    throw new AppError(httpStatus.NOT_FOUND, "Cart not found");
  }

  cart.items = cart.items.filter((i) => String(i.productId) !== productId);
  await cart.save();
  return getMyCart(userId);
};

const clearCart = async (userId: string) => {
  const cart = await Cart.findOne({ userId });
  if (cart) {
    cart.items = [];
    await cart.save();
  }
  return getMyCart(userId);
};

const SUGGESTION_LIMIT_MAX = 20;
/** Only orders that went ahead count as "bought together". */
const BOUGHT_STATUSES = [
  SubOrderStatus.accepted,
  SubOrderStatus.preparing,
  SubOrderStatus.ready_for_pickup,
  SubOrderStatus.in_delivery,
  SubOrderStatus.delivered,
];

/**
 * "Customers also bought" for the cart: products found in the same orders as the cart's
 * products (most often first), topped up with popular products of the same categories.
 * Only approved, in-stock products; never what is already in the cart. Counts only —
 * nothing about who bought them.
 */
const getSuggestions = async (userId: string, limitInput?: unknown) => {
  const limit = Math.min(SUGGESTION_LIMIT_MAX, Math.max(1, Number(limitInput) || 10));
  const cart = await Cart.findOne({ userId }).lean();
  const cartIds = (cart?.items ?? []).map((i) => new Types.ObjectId(String(i.productId)));
  if (cartIds.length === 0) return [];

  const together = await SubOrder.aggregate<{ _id: Types.ObjectId; orders: number }>([
    { $match: { "items.productId": { $in: cartIds }, status: { $in: BOUGHT_STATUSES } } },
    { $sort: { createdAt: -1 } },
    // Recent history is enough and keeps this cheap
    { $limit: 500 },
    { $unwind: "$items" },
    { $match: { "items.productId": { $nin: cartIds } } },
    { $group: { _id: "$items.productId", orders: { $sum: 1 } } },
    { $sort: { orders: -1 } },
    { $limit: limit * 3 },
  ]);

  const buyable = {
    isDeleted: false,
    approvalStatus: ProductApprovalStatus.approved,
    isAvailable: true,
    stockQty: { $gt: 0 },
  };
  const populateStore = "storeName logo address.city isOpen isPlatformStore stats.ratingAvg";

  const ranked = together.map((t) => t._id);
  const fromOrders = ranked.length
    ? await Product.find({ ...buyable, _id: { $in: ranked } })
        .populate("vendorId", populateStore)
        .populate("categoryId", "name slug")
        .lean()
    : [];
  const order = new Map(ranked.map((id, i) => [String(id), i]));
  fromOrders.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  const picked = fromOrders.slice(0, limit);
  if (picked.length >= limit) return picked;

  // Top up: best sellers of the cart's categories
  const cartProducts = await Product.find({ _id: { $in: cartIds } }, { categoryId: 1 }).lean();
  const categoryIds = [...new Set(cartProducts.map((p) => String(p.categoryId)))].map((id) => new Types.ObjectId(id));
  const exclude = [...cartIds, ...picked.map((p) => p._id)];
  const popular = await Product.find({ ...buyable, categoryId: { $in: categoryIds }, _id: { $nin: exclude } })
    .populate("vendorId", populateStore)
    .populate("categoryId", "name slug")
    .sort({ soldCount: -1, ratingAvg: -1, createdAt: -1 })
    .limit(limit - picked.length)
    .lean();
  return [...picked, ...popular];
};

export const CartServices = {
  getMyCart,
  getSuggestions,
  addToCart,
  updateItemQty,
  removeItem,
  clearCart,
};

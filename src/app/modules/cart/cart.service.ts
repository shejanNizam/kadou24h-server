import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { Product } from "../product/product.model";
import { ProductApprovalStatus } from "../product/product.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
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

export const CartServices = {
  getMyCart,
  addToCart,
  updateItemQty,
  removeItem,
  clearCart,
};

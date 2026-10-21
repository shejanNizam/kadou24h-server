import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { CartServices } from "./cart.service";

const getMyCart = catchAsync(async (req: Request, res: Response) => {
  const result = await CartServices.getMyCart(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cart retrieved successfully",
    data: result,
  });
});

const getSuggestions = catchAsync(async (req: Request, res: Response) => {
  const result = await CartServices.getSuggestions(req.user._id, req.query.limit);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Suggestions retrieved successfully",
    data: result,
  });
});

const addToCart = catchAsync(async (req: Request, res: Response) => {
  const { productId, qty } = req.body;
  const result = await CartServices.addToCart(req.user._id, productId, qty);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Item added to cart successfully",
    data: result,
  });
});

const updateItemQty = catchAsync(async (req: Request, res: Response) => {
  const { qty } = req.body;
  const result = await CartServices.updateItemQty(
    req.user._id,
    req.params.productId as string,
    qty,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cart item updated successfully",
    data: result,
  });
});

const removeItem = catchAsync(async (req: Request, res: Response) => {
  const result = await CartServices.removeItem(
    req.user._id,
    req.params.productId as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Item removed from cart successfully",
    data: result,
  });
});

const clearCart = catchAsync(async (req: Request, res: Response) => {
  const result = await CartServices.clearCart(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cart cleared successfully",
    data: result,
  });
});

export const CartControllers = {
  getMyCart,
  getSuggestions,
  addToCart,
  updateItemQty,
  removeItem,
  clearCart,
};

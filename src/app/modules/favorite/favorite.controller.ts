import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { FavoriteServices } from "./favorite.service";
import { flatQuery } from "../../utils/queryParams";

const toggleFavorite = catchAsync(async (req: Request, res: Response) => {
  const { productId } = req.body;
  const result = await FavoriteServices.toggleFavorite(req.user._id, productId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const getMyFavorites = catchAsync(async (req: Request, res: Response) => {
  const result = await FavoriteServices.getMyFavorites(req.user._id, flatQuery(req.query));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Favorites retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const checkIsFavorite = catchAsync(async (req: Request, res: Response) => {
  const result = await FavoriteServices.checkIsFavorite(
    req.user._id,
    req.params.productId as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Favorite status checked successfully!",
    data: { isFavorite: result },
  });
});

export const FavoriteControllers = {
  toggleFavorite,
  getMyFavorites,
  checkIsFavorite,
};

import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { CategoryType } from "./category.interface";
import { CategoryServices } from "./category.service";

const getCategories = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryServices.getCategories(req.query as Record<string, string>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Categories retrieved successfully!",
    data: result,
  });
});

const getCategoryTree = catchAsync(async (req: Request, res: Response) => {
  const type = req.query.type as CategoryType;
  if (!Object.values(CategoryType).includes(type)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Query `type` must be product, business, service or job");
  }
  const result = await CategoryServices.getCategoryTree(type);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category tree retrieved successfully!",
    data: result,
  });
});

const getSingleCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryServices.getSingleCategory(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category retrieved successfully!",
    data: result,
  });
});

const getAllCategoriesForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryServices.getAllCategoriesForAdmin(
    req.query as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Categories retrieved successfully!",
    data: result,
  });
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryServices.createCategory(req.body, req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Category created successfully!",
    data: result,
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryServices.updateCategory(
    req.params.id as string,
    req.body,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category updated successfully!",
    data: result,
  });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  await CategoryServices.deleteCategory(req.params.id as string, req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category deleted successfully!",
    data: null,
  });
});

export const CategoryControllers = {
  getCategories,
  getCategoryTree,
  getSingleCategory,
  getAllCategoriesForAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
};

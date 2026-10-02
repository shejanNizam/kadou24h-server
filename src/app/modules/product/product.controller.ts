import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ProductServices } from "./product.service";

const createProduct = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductServices.createProduct(req.body, req.user._id, req.user.roles);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Product created successfully!",
    data: result,
  });
});

const updateProduct = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductServices.updateProduct(
    req.params.id as string,
    req.body,
    req.user._id,
    req.user.roles,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product updated successfully!",
    data: result,
  });
});

const updateProductStock = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductServices.updateProductStock(
    req.params.id as string,
    req.body,
    req.user._id,
    req.user.roles,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product stock updated successfully!",
    data: result,
  });
});

const deleteProduct = catchAsync(async (req: Request, res: Response) => {
  await ProductServices.deleteProduct(req.params.id as string, req.user._id, req.user.roles);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product deleted successfully!",
    data: null,
  });
});

const reviewProductApproval = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductServices.reviewProductApproval(req.params.id as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Product ${result.approvalStatus} successfully!`,
    data: result,
  });
});

const getPublicProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductServices.getPublicProducts(req.query as any);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Products retrieved successfully!",
    data: result,
  });
});

const getProductByIdOrSlug = catchAsync(async (req: Request, res: Response) => {
  const currentUserId = req.user?._id;
  const result = await ProductServices.getProductByIdOrSlug(
    req.params.idOrSlug as string,
    currentUserId,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product details retrieved successfully!",
    data: result,
  });
});

const getVendorProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductServices.getVendorProducts(req.user._id, req.query as any);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Vendor products retrieved successfully!",
    data: result,
  });
});

const getAdminProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductServices.getAdminProducts(req.query as any);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin products retrieved successfully!",
    data: result,
  });
});

export const ProductControllers = {
  createProduct,
  updateProduct,
  updateProductStock,
  deleteProduct,
  reviewProductApproval,
  getPublicProducts,
  getProductByIdOrSlug,
  getVendorProducts,
  getAdminProducts,
};

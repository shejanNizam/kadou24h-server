import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ReviewServices } from "./review.service";

const createReview = catchAsync(async (req: Request, res: Response) => {
  const authorId = req.user._id;
  const result = await ReviewServices.createReview(authorId, req.body);

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Review submitted successfully",
    data: result,
  });
});

const getVendorReviews = catchAsync(async (req: Request, res: Response) => {
  const vendorId = req.params.vendorId as string;
  const result = await ReviewServices.getVendorReviews(vendorId, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Vendor reviews retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getProductReviews = catchAsync(async (req: Request, res: Response) => {
  const productId = req.params.productId as string;
  const result = await ReviewServices.getProductReviews(productId, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Product reviews retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getMyReviews = catchAsync(async (req: Request, res: Response) => {
  const authorId = req.user._id;
  const result = await ReviewServices.getMyReviews(authorId, req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "My reviews retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const reportReview = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await ReviewServices.reportReview(id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Review reported successfully",
    data: result,
  });
});

const updateReviewStatusAdmin = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user._id;
  const id = req.params.id as string;
  const { status } = req.body;
  const result = await ReviewServices.updateReviewStatusAdmin(adminId, id, status);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Review status updated successfully",
    data: result,
  });
});

export const ReviewControllers = {
  createReview,
  getVendorReviews,
  getProductReviews,
  getMyReviews,
  reportReview,
  updateReviewStatusAdmin,
};

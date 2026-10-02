import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AddressServices } from "./address.service";

const getMyAddresses = catchAsync(async (req: Request, res: Response) => {
  const result = await AddressServices.getMyAddresses(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Addresses retrieved successfully!",
    data: result,
  });
});

const createAddress = catchAsync(async (req: Request, res: Response) => {
  const result = await AddressServices.createAddress(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Address added successfully!",
    data: result,
  });
});

const updateAddress = catchAsync(async (req: Request, res: Response) => {
  const result = await AddressServices.updateAddress(
    req.user._id,
    req.params.addressId as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Address updated successfully!",
    data: result,
  });
});

const setDefaultAddress = catchAsync(async (req: Request, res: Response) => {
  const result = await AddressServices.setDefaultAddress(
    req.user._id,
    req.params.addressId as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Default address updated!",
    data: result,
  });
});

const deleteAddress = catchAsync(async (req: Request, res: Response) => {
  await AddressServices.deleteAddress(req.user._id, req.params.addressId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Address deleted successfully!",
    data: null,
  });
});

export const AddressControllers = {
  getMyAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
};

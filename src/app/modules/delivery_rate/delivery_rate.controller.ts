import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import {
  DeliveryRateType,
  DeliveryVehicleType,
} from "./delivery_rate.interface";
import { DeliveryRateServices } from "./delivery_rate.service";

const calculateDeliveryFee = catchAsync(async (req: Request, res: Response) => {
  const {
    type,
    vendorLat,
    vendorLng,
    customerLat,
    customerLng,
    city,
    vehicleType,
    fromStationId,
    toStationId,
  } = req.query;

  const result = await DeliveryRateServices.calculateDeliveryFee({
    type: (type as DeliveryRateType) || DeliveryRateType.local,
    vendorLocation:
      vendorLng !== undefined && vendorLat !== undefined
        ? [Number(vendorLng), Number(vendorLat)]
        : undefined,
    customerLocation:
      customerLng !== undefined && customerLat !== undefined
        ? [Number(customerLng), Number(customerLat)]
        : undefined,
    city: city as string,
    vehicleType: vehicleType as DeliveryVehicleType,
    fromStationId: fromStationId as string,
    toStationId: toStationId as string,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery fee calculated successfully",
    data: result,
  });
});

const createDeliveryRate = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryRateServices.createDeliveryRate(
    req.body,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Delivery rate created successfully",
    data: result,
  });
});

const getAllDeliveryRates = catchAsync(async (req: Request, res: Response) => {
  const { type, city, isActive } = req.query;
  const result = await DeliveryRateServices.getAllDeliveryRates({
    type: type as DeliveryRateType,
    city: city as string,
    isActive: isActive !== undefined ? isActive === "true" : undefined,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery rates retrieved successfully",
    data: result,
  });
});

const getDeliveryRateById = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryRateServices.getDeliveryRateById(
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery rate retrieved successfully",
    data: result,
  });
});

const updateDeliveryRate = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryRateServices.updateDeliveryRate(
    req.params.id as string,
    req.body,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery rate updated successfully",
    data: result,
  });
});

const deleteDeliveryRate = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryRateServices.deleteDeliveryRate(
    req.params.id as string,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery rate deactivated successfully",
    data: result,
  });
});

export const DeliveryRateControllers = {
  calculateDeliveryFee,
  createDeliveryRate,
  getAllDeliveryRates,
  getDeliveryRateById,
  updateDeliveryRate,
  deleteDeliveryRate,
};

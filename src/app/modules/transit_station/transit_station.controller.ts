import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { TransitStationServices } from "./transit_station.service";

const getStations = catchAsync(async (req: Request, res: Response) => {
  const result = await TransitStationServices.getStations(req.query as Record<string, string>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bus stations retrieved successfully!",
    data: result,
  });
});

const getStationsForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await TransitStationServices.getStations(
    req.query as Record<string, string>,
    true,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bus stations retrieved successfully!",
    data: result,
  });
});

const createStation = catchAsync(async (req: Request, res: Response) => {
  const result = await TransitStationServices.createStation(req.body, req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Bus station created successfully!",
    data: result,
  });
});

const updateStation = catchAsync(async (req: Request, res: Response) => {
  const result = await TransitStationServices.updateStation(
    req.params.id as string,
    req.body,
    req.user._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bus station updated successfully!",
    data: result,
  });
});

export const TransitStationControllers = {
  getStations,
  getStationsForAdmin,
  createStation,
  updateStation,
};

import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { DeliveryServices } from "./delivery.service";

const getAvailableRiders = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.getAvailableRiders(
    req.user._id,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Available delivery partners retrieved successfully",
    data: result,
  });
});

const assignRider = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.assignRider(
    req.user._id,
    req.params.id as string,
    req.body.riderId,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery leg assigned to partner successfully",
    data: result,
  });
});

const getOffers = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.getOffers(req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Open deliveries near you retrieved successfully",
    data: result,
  });
});

const claimOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.claimOffer(req.user._id, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery taken: it is yours",
    data: result,
  });
});

const skipOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.skipOffer(req.user._id, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Offer hidden",
    data: result,
  });
});

const acceptDelivery = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.acceptDelivery(
    req.user._id,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery leg accepted successfully",
    data: result,
  });
});

const declineDelivery = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.declineDelivery(
    req.user._id,
    req.params.id as string,
    req.body.reason,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Delivery leg declined",
    data: result,
  });
});

const goingToPickup = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.goingToPickup(
    req.user._id,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "En route to pickup location",
    data: result,
  });
});

const verifyPickup = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.verifyPickup(
    req.user._id,
    req.params.id as string,
    req.body.pin,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pickup verified successfully via PIN",
    data: result,
  });
});

const verifyHandover = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.verifyHandover(
    req.user._id,
    req.params.id as string,
    req.body.pin,
    req.body.proofPhoto,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Handover verified successfully via PIN",
    data: result,
  });
});

const trackDelivery = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.trackDelivery(
    req.user._id,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Live tracking details retrieved successfully",
    data: result,
  });
});

const updateRiderLocation = catchAsync(async (req: Request, res: Response) => {
  const { lat, lng, heading } = req.body;
  const result = await DeliveryServices.updateRiderLocation(
    req.user._id,
    lat,
    lng,
    heading,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Rider location broadcasted successfully",
    data: result,
  });
});

const toggleRiderOnline = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.toggleRiderOnline(
    req.user._id,
    req.body.isOnline,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Driver mode turned ${req.body.isOnline ? "online" : "offline"}`,
    data: result,
  });
});

const getMyDeliveries = catchAsync(async (req: Request, res: Response) => {
  const result = await DeliveryServices.getMyDeliveries(
    req.user._id,
    req.query as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Rider deliveries retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

export const DeliveryControllers = {
  getAvailableRiders,
  assignRider,
  getOffers,
  claimOffer,
  skipOffer,
  acceptDelivery,
  declineDelivery,
  goingToPickup,
  verifyPickup,
  verifyHandover,
  trackDelivery,
  updateRiderLocation,
  toggleRiderOnline,
  getMyDeliveries,
};

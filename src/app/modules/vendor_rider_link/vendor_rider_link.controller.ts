import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { LinkStatus } from "./vendor_rider_link.interface";
import { VendorRiderLinkServices } from "./vendor_rider_link.service";

const getMyLinks = catchAsync(async (req: Request, res: Response) => {
  const as = req.query.as as "vendor" | "rider";
  if (as !== "vendor" && as !== "rider") {
    throw new AppError(httpStatus.BAD_REQUEST, "LINK_SIDE_INVALID");
  }
  const status = req.query.status as LinkStatus | undefined;
  if (status && !Object.values(LinkStatus).includes(status)) {
    throw new AppError(httpStatus.BAD_REQUEST, "STATUS_INVALID");
  }

  const result = await VendorRiderLinkServices.getMyLinks(req.user._id, as, status);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Connections retrieved successfully!",
    data: result,
  });
});

const inviteRider = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorRiderLinkServices.inviteRider(req.user._id, req.body.riderId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.status === LinkStatus.active ? "Connected!" : "Invitation sent",
    data: result,
  });
});

const requestVendor = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorRiderLinkServices.requestVendor(req.user._id, req.body.vendorId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.status === LinkStatus.active ? "Connected!" : "Request sent",
    data: result,
  });
});

const respond = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorRiderLinkServices.respond(
    req.params.id as string,
    req.user._id,
    req.body.accept,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.status === LinkStatus.active ? "Connected!" : "Invitation declined",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  const result = await VendorRiderLinkServices.remove(req.params.id as string, req.user._id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Connection removed",
    data: result,
  });
});

export const VendorRiderLinkControllers = {
  getMyLinks,
  inviteRider,
  requestVendor,
  respond,
  remove,
};

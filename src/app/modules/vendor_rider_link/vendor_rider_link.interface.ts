import { Document, Types } from "mongoose";

export enum LinkInitiator {
  vendor = "vendor",
  rider = "rider",
}

export enum LinkStatus {
  invited = "invited", // waiting for the other party
  active = "active",
  declined = "declined",
  removed = "removed",
}

// A vendor's rider network. Linked riders are offered first when assigning a delivery.
export interface IVendorRiderLinkInitial {
  vendorId: Types.ObjectId; // vendor_profiles._id
  riderId: Types.ObjectId; // rider_profiles._id
  initiatedBy: LinkInitiator;
  status: LinkStatus;
  invitedAt: Date;
  respondedAt?: Date;
}

export type IVendorRiderLink = IVendorRiderLinkInitial & Document;

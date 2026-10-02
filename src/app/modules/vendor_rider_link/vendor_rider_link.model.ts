import { model, Schema } from "mongoose";
import { IVendorRiderLink, LinkInitiator, LinkStatus } from "./vendor_rider_link.interface";

const vendorRiderLinkSchema = new Schema<IVendorRiderLink>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "VendorProfile", required: true },
    riderId: { type: Schema.Types.ObjectId, ref: "RiderProfile", required: true },
    initiatedBy: { type: String, enum: Object.values(LinkInitiator), required: true },
    status: { type: String, enum: Object.values(LinkStatus), default: LinkStatus.invited },
    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

vendorRiderLinkSchema.index({ vendorId: 1, riderId: 1 }, { unique: true });
vendorRiderLinkSchema.index({ vendorId: 1, status: 1 });
vendorRiderLinkSchema.index({ riderId: 1, status: 1 });

export const VendorRiderLink = model<IVendorRiderLink>("VendorRiderLink", vendorRiderLinkSchema);

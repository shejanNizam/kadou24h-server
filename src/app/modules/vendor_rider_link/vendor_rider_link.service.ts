import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { emitToUser } from "../../../socket/socket";
import { ApprovalStatus } from "../profile_common/profile.common";
import { PartnerType } from "../rider_profile/rider_profile.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { LinkInitiator, LinkStatus } from "./vendor_rider_link.interface";
import { VendorRiderLink } from "./vendor_rider_link.model";

const approvedVendorOf = async (userId: string) => {
  const vendor = await VendorProfile.findOne({ userId, approvalStatus: ApprovalStatus.approved });
  if (!vendor) throw new AppError(httpStatus.FORBIDDEN, "You need an approved store");
  return vendor;
};

const approvedRiderOf = async (userId: string) => {
  const rider = await RiderProfile.findOne({ userId, approvalStatus: ApprovalStatus.approved });
  if (!rider) throw new AppError(httpStatus.FORBIDDEN, "You need an approved delivery partner account");
  return rider;
};

/**
 * Shared by invite (vendor → rider) and request (rider → vendor).
 * - already active            → 409
 * - pending from the same side → 409
 * - pending from the other side → becomes active (both want it)
 * - declined / removed         → re-opened as a new invitation
 */
const createOrReopen = async (vendorId: string, riderId: string, by: LinkInitiator) => {
  const existing = await VendorRiderLink.findOne({ vendorId, riderId });

  if (existing?.status === LinkStatus.active) {
    throw new AppError(httpStatus.CONFLICT, "You are already connected");
  }
  if (existing?.status === LinkStatus.invited) {
    if (existing.initiatedBy === by) {
      throw new AppError(httpStatus.CONFLICT, "Invitation already sent — waiting for an answer");
    }
    existing.status = LinkStatus.active;
    existing.respondedAt = new Date();
    return existing.save();
  }

  if (existing) {
    existing.set({ initiatedBy: by, status: LinkStatus.invited, invitedAt: new Date(), respondedAt: undefined });
    return existing.save();
  }
  return VendorRiderLink.create({ vendorId, riderId, initiatedBy: by });
};

const inviteRider = async (vendorUserId: string, riderId: string) => {
  const vendor = await approvedVendorOf(vendorUserId);
  const rider = await RiderProfile.findOne({
    _id: riderId,
    approvalStatus: ApprovalStatus.approved,
    partnerType: PartnerType.moto,
  });
  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "Delivery partner not found");
  if (String(rider.userId) === vendorUserId) {
    throw new AppError(httpStatus.BAD_REQUEST, "You cannot link your own delivery account to your store");
  }

  const link = await createOrReopen(String(vendor._id), riderId, LinkInitiator.vendor);
  emitToUser(String(rider.userId), "rider_link:updated", { linkId: link._id, status: link.status });
  return link;
};

const requestVendor = async (riderUserId: string, vendorId: string) => {
  const rider = await approvedRiderOf(riderUserId);
  if (rider.partnerType !== PartnerType.moto) {
    throw new AppError(httpStatus.BAD_REQUEST, "Only local delivery partners can join a store network");
  }
  const vendor = await VendorProfile.findOne({ _id: vendorId, approvalStatus: ApprovalStatus.approved });
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Store not found");
  if (String(vendor.userId) === riderUserId) {
    throw new AppError(httpStatus.BAD_REQUEST, "You cannot link your own store to your delivery account");
  }

  const link = await createOrReopen(vendorId, String(rider._id), LinkInitiator.rider);
  emitToUser(String(vendor.userId), "rider_link:updated", { linkId: link._id, status: link.status });
  return link;
};

/** Loads a link and the caller's side of it (throws if the caller is not part of it). */
const loadForParty = async (linkId: string, userId: string) => {
  const link = await VendorRiderLink.findById(linkId);
  if (!link) throw new AppError(httpStatus.NOT_FOUND, "Connection not found");

  const [vendor, rider] = await Promise.all([
    VendorProfile.findById(link.vendorId).select("userId"),
    RiderProfile.findById(link.riderId).select("userId"),
  ]);
  const side =
    String(vendor?.userId) === userId
      ? LinkInitiator.vendor
      : String(rider?.userId) === userId
        ? LinkInitiator.rider
        : null;
  if (!side) throw new AppError(httpStatus.NOT_FOUND, "Connection not found");

  const otherUserId = side === LinkInitiator.vendor ? rider?.userId : vendor?.userId;
  return { link, side, otherUserId };
};

const respond = async (linkId: string, userId: string, accept: boolean) => {
  const { link, side, otherUserId } = await loadForParty(linkId, userId);

  if (link.status !== LinkStatus.invited) {
    throw new AppError(httpStatus.CONFLICT, "This invitation is no longer pending");
  }
  if (link.initiatedBy === side) {
    throw new AppError(httpStatus.FORBIDDEN, "Only the invited party can answer");
  }

  link.status = accept ? LinkStatus.active : LinkStatus.declined;
  link.respondedAt = new Date();
  await link.save();

  if (otherUserId) emitToUser(String(otherUserId), "rider_link:updated", { linkId, status: link.status });
  return link;
};

const remove = async (linkId: string, userId: string) => {
  const { link, otherUserId } = await loadForParty(linkId, userId);
  if (link.status === LinkStatus.removed || link.status === LinkStatus.declined) return link;

  link.status = LinkStatus.removed;
  link.respondedAt = new Date();
  await link.save();

  if (otherUserId) emitToUser(String(otherUserId), "rider_link:updated", { linkId, status: link.status });
  return link;
};

/** My connections, seen as a vendor (riders) or as a rider (stores). */
const getMyLinks = async (userId: string, as: "vendor" | "rider", status?: LinkStatus) => {
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;

  if (as === "vendor") {
    const vendor = await VendorProfile.findOne({ userId }).select("_id");
    if (!vendor) return [];
    filter.vendorId = vendor._id;
    return VendorRiderLink.find(filter)
      .sort({ updatedAt: -1 })
      .populate({
        path: "riderId",
        select: "userId partnerType vehicle.type vehicle.color cityArea isOnline stats",
        populate: { path: "userId", select: "name avatar" },
      })
      .lean();
  }

  const rider = await RiderProfile.findOne({ userId }).select("_id");
  if (!rider) return [];
  filter.riderId = rider._id;
  return VendorRiderLink.find(filter)
    .sort({ updatedAt: -1 })
    .populate("vendorId", "storeName logo address.city address.text isOpen stats")
    .lean();
};

export const VendorRiderLinkServices = {
  inviteRider,
  requestVendor,
  respond,
  remove,
  getMyLinks,
};

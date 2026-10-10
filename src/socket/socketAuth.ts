/**
 * Permission checks for socket rooms. Uses models only (not services) so the
 * socket layer has no circular imports with services that emit events.
 */
import { Types } from "mongoose";
import { Conversation } from "../app/modules/chat/conversation.model";
import { Delivery } from "../app/modules/delivery/delivery.model";
import { Order } from "../app/modules/order/order.model";
import { SubOrder } from "../app/modules/order/sub_order.model";
import { RiderProfile } from "../app/modules/rider_profile/rider_profile.model";
import { ADMIN_ROLES, UserStatus } from "../app/modules/user/user.interface";
import { User } from "../app/modules/user/user.model";
import { VendorProfile } from "../app/modules/vendor_profile/vendor_profile.model";

/** Same rules as checkAuth: the account must exist, be active and the token current. */
export const loadSocketUser = async (userId: string, tokenVersion: number) => {
  if (!Types.ObjectId.isValid(userId)) return null;
  const user = await User.findById(userId)
    .select("roles status tokenVersion isDeleted isPhoneVerified isEmailVerified")
    .lean();

  if (!user || user.isDeleted) return null;
  if (user.tokenVersion !== tokenVersion) return null;
  if (user.status === UserStatus.suspended || user.status === UserStatus.banned) return null;
  if (!user.isPhoneVerified && !user.isEmailVerified) return null;
  return user;
};

export const isAdminRole = (roles: string[]) =>
  roles.some((r) => (ADMIN_ROLES as string[]).includes(r));

export const canJoinConversation = async (userId: string, conversationId: string) => {
  if (!Types.ObjectId.isValid(conversationId)) return false;
  return Boolean(
    await Conversation.exists({ _id: conversationId, "participants.userId": userId }),
  );
};

/**
 * Who may watch a delivery leg live: the customer, the store owner, the rider
 * of this leg or an adjacent leg (station handovers), and admins.
 */
export const canWatchDelivery = async (userId: string, roles: string[], deliveryId: string) => {
  if (!Types.ObjectId.isValid(deliveryId)) return false;
  if (isAdminRole(roles)) return true;

  const delivery = await Delivery.findById(deliveryId).select("subOrderId orderId legNumber riderId").lean();
  if (!delivery) return false;

  const [order, subOrder, rider] = await Promise.all([
    Order.findById(delivery.orderId).select("customerId").lean(),
    SubOrder.findById(delivery.subOrderId).select("vendorId").lean(),
    RiderProfile.findOne({ userId }).select("_id").lean(),
  ]);

  if (order && String(order.customerId) === userId) return true;

  if (subOrder) {
    const vendor = await VendorProfile.findById(subOrder.vendorId).select("userId").lean();
    if (vendor && String(vendor.userId) === userId) return true;
  }

  if (rider) {
    const legs = await Delivery.find({
      subOrderId: delivery.subOrderId,
      legNumber: { $in: [delivery.legNumber - 1, delivery.legNumber, delivery.legNumber + 1] },
      riderId: rider._id,
    })
      .select("_id")
      .lean();
    if (legs.length > 0) return true;
  }

  return false;
};

/** Only the rider assigned to the leg may broadcast its location. */
export const isAssignedRider = async (userId: string, deliveryId: string) => {
  if (!Types.ObjectId.isValid(deliveryId)) return false;
  const rider = await RiderProfile.findOne({ userId }).select("_id").lean();
  if (!rider) return false;
  return Boolean(await Delivery.exists({ _id: deliveryId, riderId: rider._id }));
};

import { Types } from "mongoose";
import { ChatServices } from "../chat/chat.service";
import { DeliveryDispatch } from "../delivery/delivery.dispatch.service";
import { DeliveryStatus } from "../delivery/delivery.interface";
import { Delivery } from "../delivery/delivery.model";
import { Notification } from "../notification/notification.model";
import { SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { myRiderProfile, rideOffersFor } from "../ride/ride.service";
import { RideBidStatus } from "../ride/ride.interface";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { AppMode, UserRole } from "./user.interface";

/** What waits for me in one mode */
export interface ModeAlert {
  /** Work to answer: new orders to accept (vendor); deliveries to answer, open deliveries and moto rides near me (rider) */
  pending: number;
  /** Unread notifications of this mode only (team messages have no mode: they show in every list) */
  unread: number;
  /** Unread chat messages of this mode */
  messages: number;
}

const unreadOf = (userId: string, mode: AppMode) =>
  Notification.countDocuments({ userId: new Types.ObjectId(userId), mode, isRead: false });

const messagesOf = async (userId: string, mode: AppMode) => (await ChatServices.getUnreadCount(userId, mode)).unreadCount;

/** New orders waiting for my store to accept them */
const vendorPending = async (userId: string) => {
  const store = await VendorProfile.findOne({ userId }).select("_id").lean();
  return store ? SubOrder.countDocuments({ vendorId: store._id, status: SubOrderStatus.new }) : 0;
};

/**
 * Rider: deliveries a store gave me (to accept or decline), open deliveries I can take
 * and moto rides I can still answer (a price of mine waiting for the passenger is not work).
 * The same lists as the "Near me" tab, so the count always matches what I find there.
 */
const riderPending = async (userId: string) => {
  const rider = await myRiderProfile(userId);
  const [assigned, deliveries, rides] = await Promise.all([
    Delivery.countDocuments({ riderId: rider._id, status: DeliveryStatus.assigned }),
    DeliveryDispatch.getOffers(userId),
    rideOffersFor(rider),
  ]);
  const openDeliveries = deliveries.offers.filter((o) => o.canTake).length;
  const openRides = rides.filter((r) => r.myBid?.status === RideBidStatus.countered || (r.myBid?.status !== RideBidStatus.pending && r.bidsLeft > 0)).length;
  return assigned + openDeliveries + openRides;
};

const alertFor = async (userId: string, mode: AppMode, pending: () => Promise<number>): Promise<ModeAlert> => {
  const [work, unread, messages] = await Promise.all([pending(), unreadOf(userId, mode), messagesOf(userId, mode)]);
  return { pending: work, unread, messages };
};

/**
 * The red dots on the modes I'm not in (client 2026-11-22): a seller or rider shopping
 * as a customer still sees that an order or a ride waits. Only the modes I hold.
 */
const getModeAlerts = async (userId: string, roles: UserRole[]) => {
  const [customer, vendor, rider] = await Promise.all([
    alertFor(userId, AppMode.customer, async () => 0),
    roles.includes(UserRole.vendor) ? alertFor(userId, AppMode.vendor, () => vendorPending(userId)) : undefined,
    roles.includes(UserRole.rider) ? alertFor(userId, AppMode.rider, () => riderPending(userId)) : undefined,
  ]);
  return { customer, ...(vendor && { vendor }), ...(rider && { rider }) };
};

export const UserAlertServices = { getModeAlerts };

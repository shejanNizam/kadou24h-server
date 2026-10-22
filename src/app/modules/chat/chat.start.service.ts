/**
 * Starting a chat. The app says WHAT the chat is about (a store, a worker, one
 * store's part of an order, a job application) and the server works out WHO
 * the other person is and in which mode. Nobody can pick an arbitrary
 * recipient or claim a mode they don't have (e.g. "rider" to unlock voice notes).
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Delivery } from "../delivery/delivery.model";
import { Job } from "../job/job.model";
import { JobApplication } from "../job/job_application.model";
import { SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { Booking } from "../booking/booking.model";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { publicWorkerFilter } from "../professional_profile/worker_listing";
import { ApprovalStatus } from "../profile_common/profile.common";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { AppMode } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { ConversationType } from "./chat.interface";

export type StartConversationInput =
  | { type: ConversationType.buyer_seller; vendorId: string }
  | { type: ConversationType.worker; workerProfileId?: string; bookingId?: string }
  | { type: ConversationType.order; subOrderId: string; with: "vendor" | "rider" | "customer" }
  | { type: ConversationType.job_application; applicationId: string };

interface Party {
  userId: Types.ObjectId;
  mode: AppMode;
}

export interface ResolvedConversation {
  type: ConversationType;
  me: Party;
  other: Party;
  context: {
    orderId?: Types.ObjectId;
    subOrderId?: Types.ObjectId;
    workerProfileId?: Types.ObjectId;
    applicationId?: Types.ObjectId;
  };
  /** Client rule: voice notes only between the buyer and the rider */
  allowVoice: boolean;
}

const oid = (id: unknown) => new Types.ObjectId(String(id));
const notFound = (what: string) => new AppError(httpStatus.NOT_FOUND, `${what} not found`);

export const resolveConversation = async (
  userId: string,
  input: StartConversationInput,
): Promise<ResolvedConversation> => {
  const me = oid(userId);

  if (input.type === ConversationType.buyer_seller) {
    const vendor = await VendorProfile.findOne({ _id: input.vendorId, approvalStatus: ApprovalStatus.approved }).select("userId");
    if (!vendor) throw notFound("Store");
    if (String(vendor.userId) === userId) {
      throw new AppError(httpStatus.BAD_REQUEST, "You cannot start a conversation with yourself");
    }
    return {
      type: input.type,
      me: { userId: me, mode: AppMode.customer },
      other: { userId: vendor.userId, mode: AppMode.vendor },
      context: {},
      allowVoice: false,
    };
  }

  // A booking: the customer and the worker can write to each other whatever the listing
  if (input.type === ConversationType.worker && input.bookingId) {
    const booking = await Booking.findById(input.bookingId).select("customerId workerId workerProfileId");
    if (!booking) throw notFound("Booking");
    const parties = [booking.customerId, booking.workerId];
    const other = parties.find((p) => String(p) !== userId);
    if (!parties.some((p) => String(p) === userId) || !other) {
      throw new AppError(httpStatus.FORBIDDEN, "You are not part of this booking");
    }
    return {
      type: input.type,
      me: { userId: me, mode: AppMode.customer },
      other: { userId: other, mode: AppMode.customer },
      context: { workerProfileId: booking.workerProfileId },
      allowVoice: false,
    };
  }

  if (input.type === ConversationType.worker) {
    if (!input.workerProfileId) throw new AppError(httpStatus.BAD_REQUEST, "workerProfileId or bookingId is required");
    // Only workers customers can see right now (approved, visibility paid, not suspended)
    const profile = await ProfessionalProfile.findOne({ _id: input.workerProfileId, ...publicWorkerFilter() }).select("userId");
    if (!profile) throw notFound("Worker");
    if (String(profile.userId) === userId) {
      throw new AppError(httpStatus.BAD_REQUEST, "You cannot start a conversation with yourself");
    }
    return {
      type: input.type,
      me: { userId: me, mode: AppMode.customer },
      other: { userId: profile.userId, mode: AppMode.customer },
      context: { workerProfileId: profile._id as Types.ObjectId },
      allowVoice: false,
    };
  }

  if (input.type === ConversationType.order) {
    const subOrder = await SubOrder.findById(input.subOrderId).select("orderId customerId vendorId currentRiderId status");
    if (!subOrder) throw notFound("Order");
    // The store only receives an online order once it is paid
    if (subOrder.status === SubOrderStatus.pending_payment) {
      throw new AppError(httpStatus.BAD_REQUEST, "Pay for this order first — the store receives it once paid");
    }
    const [vendor, legs, myRider] = await Promise.all([
      VendorProfile.findById(subOrder.vendorId).select("userId"),
      Delivery.find({ subOrderId: subOrder._id }).select("riderId"),
      RiderProfile.findOne({ userId: me }).select("_id"),
    ]);

    // Every role I hold in THIS store's delivery
    const myModes: AppMode[] = [];
    if (String(subOrder.customerId) === userId) myModes.push(AppMode.customer);
    if (vendor && String(vendor.userId) === userId) myModes.push(AppMode.vendor);
    if (myRider && legs.some((l) => l.riderId && String(l.riderId) === String(myRider._id))) myModes.push(AppMode.rider);
    if (!myModes.length) {
      throw new AppError(httpStatus.FORBIDDEN, "You are not part of this order");
    }

    let other: Party;
    if (input.with === "customer") {
      other = { userId: subOrder.customerId, mode: AppMode.customer };
    } else if (input.with === "vendor") {
      if (!vendor) throw notFound("Store");
      other = { userId: vendor.userId, mode: AppMode.vendor };
    } else {
      const rider = subOrder.currentRiderId
        ? await RiderProfile.findById(subOrder.currentRiderId).select("userId")
        : null;
      if (!rider) {
        throw new AppError(httpStatus.BAD_REQUEST, "No rider is assigned to this order yet");
      }
      other = { userId: rider.userId, mode: AppMode.rider };
    }

    const myMode = myModes.find((m) => m !== other.mode);
    if (!myMode || String(other.userId) === userId) {
      throw new AppError(httpStatus.BAD_REQUEST, "You cannot start a conversation with yourself");
    }
    const pair = new Set([myMode, other.mode]);
    return {
      type: input.type,
      me: { userId: me, mode: myMode },
      other,
      context: { orderId: subOrder.orderId, subOrderId: subOrder._id as Types.ObjectId },
      allowVoice: pair.has(AppMode.customer) && pair.has(AppMode.rider),
    };
  }

  // job_application: the applicant ↔ whoever posted the job (or the store, for a spontaneous application)
  const application = await JobApplication.findById(input.applicationId).select("applicantId jobId targetVendorId");
  if (!application) throw notFound("Application");
  let poster: Party | null = null;
  if (application.jobId) {
    const job = await Job.findById(application.jobId).select("postedBy postedByMode");
    if (job) poster = { userId: job.postedBy, mode: (job.postedByMode as AppMode) || AppMode.customer };
  } else if (application.targetVendorId) {
    const vendor = await VendorProfile.findById(application.targetVendorId).select("userId");
    if (vendor) poster = { userId: vendor.userId, mode: AppMode.vendor };
  }
  if (!poster) throw notFound("Job");
  const applicant: Party = { userId: application.applicantId, mode: AppMode.customer };
  const iAmApplicant = String(applicant.userId) === userId;
  if (!iAmApplicant && String(poster.userId) !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not part of this application");
  }
  return {
    type: ConversationType.job_application,
    me: iAmApplicant ? applicant : poster,
    other: iAmApplicant ? poster : applicant,
    context: { applicationId: application._id as Types.ObjectId },
    allowVoice: false,
  };
};

/** The other person must still exist (deleted accounts can't be messaged). */
export const assertReachable = async (userId: Types.ObjectId) => {
  const user = await User.findById(userId).select("isDeleted");
  if (!user || user.isDeleted) throw notFound("Recipient user");
};

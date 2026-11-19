/**
 * Starting a chat. The app says WHAT the chat is about (a store, a worker, one
 * store's part of an order, a job application) and the server works out WHO
 * the other person is and in which mode. Nobody can pick an arbitrary
 * recipient or claim a mode they don't have (e.g. "rider" to unlock voice notes).
 */
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import type { ErrorCode } from "../../i18n/errors";
import { Delivery } from "../delivery/delivery.model";
import { JobStatus } from "../job/job.interface";
import { Job } from "../job/job.model";
import { JobApplication } from "../job/job_application.model";
import { SubOrderStatus } from "../order/order.interface";
import { SubOrder } from "../order/sub_order.model";
import { Booking } from "../booking/booking.model";
import { ProfessionalProfile } from "../professional_profile/professional_profile.model";
import { publicWorkerFilter } from "../professional_profile/worker_listing";
import { ApprovalStatus } from "../profile_common/profile.common";
import { RideStatus } from "../ride/ride.interface";
import { Ride } from "../ride/ride.model";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { AppMode } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { ConversationType } from "./chat.interface";

export type StartConversationInput =
  | { type: ConversationType.buyer_seller; vendorId: string }
  | { type: ConversationType.worker; workerProfileId?: string; bookingId?: string }
  | { type: ConversationType.order; subOrderId: string; with: "vendor" | "rider" | "customer" }
  | { type: ConversationType.job_application; applicationId: string }
  | { type: ConversationType.ride; rideId: string };

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
    rideId?: Types.ObjectId;
  };
  /** See voiceAllowedFor */
  allowVoice: boolean;
}

/**
 * Voice notes (client, 2026-10-23): allowed in store, order (customer / store /
 * rider) and worker chats. Not in job-application chats: a recruiter pays to
 * unlock a candidate's contact, and voice can't be checked for phone numbers.
 */
export const voiceAllowedFor = (type: ConversationType | string) => type !== ConversationType.job_application;

const oid = (id: unknown) => new Types.ObjectId(String(id));
const notFound = (code: ErrorCode) => new AppError(httpStatus.NOT_FOUND, code);

export const resolveConversation = async (
  userId: string,
  input: StartConversationInput,
): Promise<ResolvedConversation> => {
  const me = oid(userId);

  if (input.type === ConversationType.buyer_seller) {
    const vendor = await VendorProfile.findOne({ _id: input.vendorId, approvalStatus: ApprovalStatus.approved }).select("userId");
    if (!vendor) throw notFound("STORE_NOT_FOUND");
    if (String(vendor.userId) === userId) {
      throw new AppError(httpStatus.BAD_REQUEST, "CHAT_SELF");
    }
    return {
      type: input.type,
      me: { userId: me, mode: AppMode.customer },
      other: { userId: vendor.userId, mode: AppMode.vendor },
      context: {},
      allowVoice: voiceAllowedFor(input.type),
    };
  }

  // A booking: the customer and the worker can write to each other whatever the listing
  if (input.type === ConversationType.worker && input.bookingId) {
    const booking = await Booking.findById(input.bookingId).select("customerId workerId workerProfileId");
    if (!booking) throw notFound("BOOKING_NOT_FOUND");
    const parties = [booking.customerId, booking.workerId];
    const other = parties.find((p) => String(p) !== userId);
    if (!parties.some((p) => String(p) === userId) || !other) {
      throw new AppError(httpStatus.FORBIDDEN, "NOT_PART_OF_BOOKING");
    }
    return {
      type: input.type,
      me: { userId: me, mode: AppMode.customer },
      other: { userId: other, mode: AppMode.customer },
      context: { workerProfileId: booking.workerProfileId },
      allowVoice: voiceAllowedFor(input.type),
    };
  }

  if (input.type === ConversationType.worker) {
    if (!input.workerProfileId) throw new AppError(httpStatus.BAD_REQUEST, "CHAT_TARGET_REQUIRED");
    // Only workers customers can see right now (approved, visibility paid, not suspended)
    const profile = await ProfessionalProfile.findOne({ _id: input.workerProfileId, ...publicWorkerFilter() }).select("userId");
    if (!profile) throw notFound("WORKER_NOT_FOUND");
    if (String(profile.userId) === userId) {
      throw new AppError(httpStatus.BAD_REQUEST, "CHAT_SELF");
    }
    return {
      type: input.type,
      me: { userId: me, mode: AppMode.customer },
      other: { userId: profile.userId, mode: AppMode.customer },
      context: { workerProfileId: profile._id as Types.ObjectId },
      allowVoice: voiceAllowedFor(input.type),
    };
  }

  if (input.type === ConversationType.order) {
    const subOrder = await SubOrder.findById(input.subOrderId).select("orderId customerId vendorId currentRiderId status");
    if (!subOrder) throw notFound("ORDER_NOT_FOUND");
    // The store only receives an online order once it is paid
    if (subOrder.status === SubOrderStatus.pending_payment) {
      throw new AppError(httpStatus.BAD_REQUEST, "CHAT_ORDER_UNPAID");
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
      throw new AppError(httpStatus.FORBIDDEN, "NOT_PART_OF_ORDER");
    }

    let other: Party;
    if (input.with === "customer") {
      other = { userId: subOrder.customerId, mode: AppMode.customer };
    } else if (input.with === "vendor") {
      if (!vendor) throw notFound("STORE_NOT_FOUND");
      other = { userId: vendor.userId, mode: AppMode.vendor };
    } else {
      const rider = subOrder.currentRiderId
        ? await RiderProfile.findById(subOrder.currentRiderId).select("userId")
        : null;
      if (!rider) {
        throw new AppError(httpStatus.BAD_REQUEST, "NO_RIDER_YET");
      }
      other = { userId: rider.userId, mode: AppMode.rider };
    }

    const myMode = myModes.find((m) => m !== other.mode);
    if (!myMode || String(other.userId) === userId) {
      throw new AppError(httpStatus.BAD_REQUEST, "CHAT_SELF");
    }
    return {
      type: input.type,
      me: { userId: me, mode: myMode },
      other,
      context: { orderId: subOrder.orderId, subOrderId: subOrder._id as Types.ObjectId },
      allowVoice: voiceAllowedFor(input.type),
    };
  }

  // Moto-taxi: the passenger ↔ the rider who took the ride. The rider already has the
  // passenger's phone; the passenger never gets the rider's (client rule), so this chat
  // is how they reach the rider: a voice note or a photo of the gate helps find them.
  if (input.type === ConversationType.ride) {
    const ride = await Ride.findById(input.rideId).select("passengerId riderId");
    if (!ride) throw notFound("RIDE_NOT_FOUND");
    const rider = ride.riderId ? await RiderProfile.findById(ride.riderId).select("userId") : null;
    const passenger: Party = { userId: ride.passengerId, mode: AppMode.customer };
    const driver: Party | null = rider ? { userId: rider.userId, mode: AppMode.rider } : null;
    const iAmPassenger = String(passenger.userId) === userId;
    if (!iAmPassenger && String(driver?.userId) !== userId) {
      throw new AppError(httpStatus.FORBIDDEN, "NOT_PART_OF_RIDE");
    }
    if (!driver) throw new AppError(httpStatus.BAD_REQUEST, "RIDE_NO_RIDER_YET");
    return {
      type: input.type,
      me: iAmPassenger ? passenger : driver,
      other: iAmPassenger ? driver : passenger,
      context: { rideId: ride._id as Types.ObjectId },
      allowVoice: voiceAllowedFor(input.type),
    };
  }

  // job_application: the applicant ↔ whoever posted the job (or the store, for a spontaneous application)
  const application = await JobApplication.findById(input.applicationId).select("applicantId jobId targetVendorId");
  if (!application) throw notFound("JOB_APPLICATION_NOT_FOUND");
  let poster: Party | null = null;
  if (application.jobId) {
    const job = await Job.findById(application.jobId).select("postedBy postedByMode status");
    if (job?.status === JobStatus.removed) throw new AppError(httpStatus.BAD_REQUEST, "JOB_REMOVED");
    if (job) poster = { userId: job.postedBy, mode: (job.postedByMode as AppMode) || AppMode.customer };
  } else if (application.targetVendorId) {
    const vendor = await VendorProfile.findById(application.targetVendorId).select("userId");
    if (vendor) poster = { userId: vendor.userId, mode: AppMode.vendor };
  }
  if (!poster) throw notFound("JOB_NOT_FOUND");
  const applicant: Party = { userId: application.applicantId, mode: AppMode.customer };
  const iAmApplicant = String(applicant.userId) === userId;
  if (!iAmApplicant && String(poster.userId) !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "NOT_PART_OF_APPLICATION");
  }
  return {
    type: ConversationType.job_application,
    me: iAmApplicant ? applicant : poster,
    other: iAmApplicant ? poster : applicant,
    context: { applicationId: application._id as Types.ObjectId },
    allowVoice: voiceAllowedFor(ConversationType.job_application),
  };
};

/** No more messages about an offer the Kadou24h team removed (rules, fraud) */
export const assertApplicationJobLive = async (applicationId: Types.ObjectId) => {
  const application = await JobApplication.findById(applicationId).select("jobId").lean();
  if (!application?.jobId) return;
  if (await Job.exists({ _id: application.jobId, status: JobStatus.removed })) {
    throw new AppError(httpStatus.BAD_REQUEST, "JOB_REMOVED");
  }
};

/** A rider is on this ride: the passenger and the rider can write to each other */
export const RIDE_CHAT_OPEN = [RideStatus.accepted, RideStatus.arrived, RideStatus.in_progress];

/** Messages only while the ride is going on; afterwards the chat stays readable */
export const assertRideChatOpen = async (rideId: Types.ObjectId) => {
  if (!(await Ride.exists({ _id: rideId, status: { $in: RIDE_CHAT_OPEN } }))) {
    throw new AppError(httpStatus.BAD_REQUEST, "RIDE_CHAT_CLOSED");
  }
};

/** The other person must still exist (deleted accounts can't be messaged). */
export const assertReachable = async (userId: Types.ObjectId) => {
  const user = await User.findById(userId).select("isDeleted");
  if (!user || user.isDeleted) throw notFound("ACCOUNT_NOT_FOUND");
};

import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { IProfessionalProfile } from "./professional_profile.interface";
import { ProfessionalProfile } from "./professional_profile.model";
import { escapeRegex } from "../../utils/queryParams";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { ConversationType, MessageType } from "../chat/chat.interface";
import { Conversation } from "../chat/conversation.model";
import { Notify } from "../notification/notification.events";
import { ApprovalStatus, ReviewAction, applyReview, markSubmitted } from "../profile_common/profile.common";
import { User } from "../user/user.model";
import { BookingStatus, StrikeRole } from "../booking/booking.interface";
import { Booking, BookingStrike } from "../booking/booking.model";
import { PENALTY } from "../booking/booking.constants";
import { grantListingGrace, isPublicWorker, publicWorkerFilter, startTrialIfFirst } from "./worker_listing";

/**
 * Never in public worker responses: ID document, CV files (paid unlock for recruiters),
 * review data, penalties and subscription details.
 */
const HIDDEN_FIELDS = [
  "idDocument",
  "uploadedResume",
  "generatedCv",
  "reviewNote",
  "reviewedBy",
  "reviewedAt",
  "submittedAt",
  "applicationHistory",
  "bookingPenalty",
  "listingNotice",
  "trialUsedAt",
  "listedUntil",
];
const PUBLIC_HIDDEN = HIDDEN_FIELDS.map((k) => `-${k}`).join(" ");

/**
 * Gets or initializes the user's professional profile.
 */
const getMyProfile = async (userId: string): Promise<IProfessionalProfile> => {
  let profile = await ProfessionalProfile.findOne({ userId });
  if (!profile) {
    profile = await ProfessionalProfile.create({
      userId: new Types.ObjectId(userId),
      skills: [],
      languages: [],
      achievements: [],
      profileEducation: [],
      profileExperience: [],
      isWorkerListed: false,
      cvVisible: false,
      ratingAvg: 0,
      ratingCount: 0,
    });
  }
  return profile;
};

/**
 * Creates or updates the user's professional profile.
 */
const upsertProfile = async (
  userId: string,
  payload: Partial<IProfessionalProfile> & {
    location?: { lat: number; lng: number };
  },
) => {
  const profile = await getMyProfile(userId);

  const { location, serviceCategoryId, ...rest } = payload;

  if (location) {
    profile.location = toGeoPoint(location);
  }

  if (serviceCategoryId) {
    profile.serviceCategoryId = new Types.ObjectId(serviceCategoryId);
  }

  // A new ID document on an approved worker profile must be checked again
  const newId = (rest as { idDocument?: { url: string } | null }).idDocument;
  if (newId && profile.approvalStatus === ApprovalStatus.approved && newId.url !== profile.idDocument?.url) {
    profile.approvalStatus = ApprovalStatus.pending;
    profile.submittedAt = new Date();
    profile.applicationHistory.push({ action: "id_document_changed", byUserId: new Types.ObjectId(userId), at: new Date() });
  }

  // null = remove the file or value (photo, CVs, ID document, working hours)
  for (const key of ["photo", "uploadedResume", "generatedCv", "idDocument", "workingHours"] as const) {
    if ((rest as Record<string, unknown>)[key] === null) {
      profile.set(key, undefined);
      Reflect.deleteProperty(rest, key);
    }
  }
  if (rest.generatedCv) profile.generatedAt = new Date();

  profile.set(rest);
  await profile.save();
  return profile;
};

/** The CV itself: what "Delete my CV" clears (client, 2026-11-22) */
const CV_FIELDS = ["summary", "uploadedResume", "generatedCv", "generatedAt"] as const;
const CV_LISTS = ["skills", "languages", "achievements", "profileEducation", "profileExperience"] as const;
/** Shared with the worker page: cleared too when I never applied as a worker */
const IDENTITY_FIELDS = ["profession", "photo", "city", "location"] as const;

/**
 * "Delete my CV": the CV text and both CV files go. A worker (who applied or is listed)
 * keeps the trade, photo and city their worker page uses; the paid visibility, ratings and
 * worker review stay. Recruiters keep the copy sent with an earlier application.
 */
const deleteMyCv = async (userId: string) => {
  const profile = await ProfessionalProfile.findOne({ userId });
  if (!profile) return getMyProfile(userId);
  const isWorker = profile.isWorkerListed || (profile.approvalStatus && profile.approvalStatus !== ApprovalStatus.draft);
  for (const key of CV_FIELDS) profile.set(key, undefined);
  for (const key of CV_LISTS) profile.set(key, []);
  if (!isWorker) for (const key of IDENTITY_FIELDS) profile.set(key, undefined);
  await profile.save();
  return profile;
};

/**
 * Toggles or updates the user's public worker listing.
 */
const toggleWorkerListing = async (
  userId: string,
  payload: {
    isWorkerListed: boolean;
    hourlyRate?: number;
    experienceYears?: number;
    serviceCategoryId?: string;
  },
) => {
  const profile = await getMyProfile(userId);

  if (payload.isWorkerListed && profile.approvalStatus !== ApprovalStatus.approved) {
    throw new AppError(httpStatus.BAD_REQUEST, "WORKER_LIST_NOT_APPROVED");
  }
  profile.isWorkerListed = payload.isWorkerListed;
  if (payload.hourlyRate !== undefined) profile.hourlyRate = payload.hourlyRate;
  if (payload.experienceYears !== undefined)
    profile.experienceYears = payload.experienceYears;
  if (payload.serviceCategoryId) {
    profile.serviceCategoryId = new Types.ObjectId(payload.serviceCategoryId);
  }

  await profile.save();
  return profile;
};

/**
 * Public search for listed workers with geo, category, text search, and rating filters.
 */
const searchWorkers = async (query: {
  search?: string;
  categoryId?: string;
  city?: string;
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
  minRating?: number;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const now = new Date();
  // Listed, approved, visibility paid (or trial), not suspended
  const filter: Record<string, unknown> = { ...publicWorkerFilter(now) };

  if (query.categoryId) {
    filter.serviceCategoryId = new Types.ObjectId(query.categoryId);
  }

  if (query.city) {
    filter.city = { $regex: escapeRegex(query.city), $options: "i" };
  }

  if (query.minRating) {
    filter.ratingAvg = { $gte: Number(query.minRating) };
  }

  if (query.search) {
    filter.$text = { $search: query.search };
  }

  // Geo radius filter
  if (query.lat !== undefined && query.lng !== undefined) {
    const radiusKm = query.maxDistanceKm ? Number(query.maxDistanceKm) : 25;
    const earthRadiusKm = 6378.1;
    filter.location = {
      $geoWithin: {
        $centerSphere: [
          [Number(query.lng), Number(query.lat)],
          radiusKm / earthRadiusKm,
        ],
      },
    };
  }

  await expireCvVisibility();

  const [rows, total] = await Promise.all([
    ProfessionalProfile.aggregate([
      { $match: filter },
      // Reduced visibility after cancellations (penalty): after everyone else
      { $addFields: { lessVisible: { $cond: [{ $gt: ["$bookingPenalty.lessVisibleUntil", now] }, 1, 0] } } },
      // Then subscribers ("priority search visibility"), then by rating
      { $sort: { lessVisible: 1, cvVisible: -1, ratingAvg: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: Object.fromEntries([...HIDDEN_FIELDS, "lessVisible"].map((k) => [k, 0])) },
    ]),
    ProfessionalProfile.countDocuments(filter),
  ]);
  // Public endpoint: never phone / email (contact goes through in-app chat)
  const workers = await ProfessionalProfile.populate(rows, [
    { path: "userId", select: "name avatar" },
    { path: "serviceCategoryId", select: "name slug" },
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: workers.map((w) => ({ ...w, isPremium: w.cvVisible })),
  };
};

/** Turns off subscription visibility that has run out (cheap, indexed). */
const expireCvVisibility = () =>
  ProfessionalProfile.updateMany(
    { cvVisible: true, visibleUntil: { $lte: new Date() } },
    { $set: { cvVisible: false } },
  );


/**
 * Public view of a single listed worker profile.
 */
const getWorkerById = async (profileId: string) => {
  const profile = await ProfessionalProfile.findOne({ _id: profileId, ...publicWorkerFilter() })
    .select(PUBLIC_HIDDEN)
    .populate("userId", "name avatar")
    .populate("serviceCategoryId", "name slug");

  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "WORKER_NOT_FOUND");
  }

  return profile;
};

/**
 * Suggests a CV summary from the profile (template-based, no AI service).
 * Nothing is saved: the app shows the text, the user edits or keeps it and
 * saves it with PUT /me. The CV document itself (PDF) is made by the app from
 * the profile and uploaded; the server never invents a file.
 */
const generateAiCv = async (
  userId: string,
  payload: { targetRole?: string; tone?: string; lang?: "fr" | "en" },
) => {
  const profile = await getMyProfile(userId);
  const fr = payload.lang !== "en";

  const role = payload.targetRole?.trim() || profile.profession?.trim();
  const years = profile.experienceYears;
  const skills = profile.skills.slice(0, 5);
  const languages = profile.languages;
  const latest = [...profile.profileExperience].sort(
    (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0),
  )[0];
  const list = (items: string[], and: string) =>
    items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;

  const sentences = fr
    ? [
        role
          ? `${role}${years ? ` avec ${years} an${years > 1 ? "s" : ""} d'expérience` : ""}, sérieux(se) et fiable.`
          : `Professionnel(le) sérieux(se) et fiable${years ? `, avec ${years} an${years > 1 ? "s" : ""} d'expérience` : ""}.`,
        latest && `Dernier poste : ${latest.title}${latest.company ? ` chez ${latest.company}` : ""}.`,
        skills.length && `Compétences : ${list(skills, "et")}.`,
        languages.length && `Langues parlées : ${list(languages, "et")}.`,
        "Disponible rapidement et motivé(e) pour rejoindre une nouvelle équipe.",
      ]
    : [
        role
          ? `${role}${years ? ` with ${years} year${years > 1 ? "s" : ""} of experience` : ""}, serious and reliable.`
          : `Serious and reliable professional${years ? ` with ${years} year${years > 1 ? "s" : ""} of experience` : ""}.`,
        latest && `Latest role: ${latest.title}${latest.company ? ` at ${latest.company}` : ""}.`,
        skills.length && `Skills: ${list(skills, "and")}.`,
        languages.length && `Languages: ${list(languages, "and")}.`,
        "Available soon and keen to join a new team.",
      ];

  return { summary: sentences.filter(Boolean).join(" ") };
};

// ── Worker application (Become a worker) ─────────────────────────────

const MIN_DESCRIPTION = 20;

/** The worker sends the profile for review: everything a customer needs, plus an ID document. */
const submitWorkerApplication = async (userId: string) => {
  const profile = await getMyProfile(userId);
  // The photo is optional (client, 2026-10-23): cards fall back to an icon
  const missing = [
    (profile.profession?.trim().length ?? 0) < 2 && "profession",
    !profile.serviceCategoryId && "serviceCategoryId",
    profile.experienceYears === undefined && "experienceYears",
    !(profile.hourlyRate && profile.hourlyRate > 0) && "hourlyRate",
    !profile.city?.trim() && "city",
    (profile.summary?.trim().length ?? 0) < MIN_DESCRIPTION && "summary",
    profile.skills.length === 0 && "skills",
    !profile.idDocument?.url && "idDocument",
  ].filter(Boolean);
  if (missing.length) {
    throw new AppError(httpStatus.BAD_REQUEST, "WORKER_PROFILE_INCOMPLETE", { fields: missing.join(", ") });
  }
  if (profile.approvalStatus === ApprovalStatus.approved) {
    throw new AppError(httpStatus.CONFLICT, "WORKER_ALREADY_APPROVED");
  }
  // Throws while pending or suspended
  markSubmitted(profile, userId);
  // Shown to customers as soon as an admin approves it
  profile.isWorkerListed = true;
  await profile.save();
  return profile;
};

/**
 * Worker home: status, visibility (trial / subscription), penalties, bookings, estimated
 * earnings (prices the worker entered — payments never go through the app), the customers
 * who wrote (worker chats) and the rating.
 */
const getWorkerSummary = async (userId: string) => {
  const profile = await getMyProfile(userId);
  // Customer requests (client, 2026-11-23): only chats where someone wrote (not just the
  // opening safety notice), and not the ones the worker deleted (they come back with a new message)
  const chats = {
    type: ConversationType.worker,
    workerProfileId: profile._id,
    "lastMessage.at": { $exists: true },
    "lastMessage.type": { $ne: MessageType.system },
    participants: { $elemMatch: { userId: profile.userId, hidden: { $ne: true } } },
  };
  const [conversations, unreadAgg, recent] = await Promise.all([
    Conversation.countDocuments(chats),
    Conversation.aggregate<{ unread: number; unreadChats: number }>([
      { $match: chats },
      { $unwind: "$participants" },
      { $match: { "participants.userId": profile.userId } },
      {
        $group: {
          _id: null,
          unread: { $sum: "$participants.unreadCount" },
          unreadChats: { $sum: { $cond: [{ $gt: ["$participants.unreadCount", 0] }, 1, 0] } },
        },
      },
    ]),
    Conversation.find(chats).sort({ "lastMessage.at": -1 }).limit(5).lean(),
  ]);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [byStatus, earned, strikes] = await Promise.all([
    Booking.aggregate<{ _id: BookingStatus; n: number }>([
      { $match: { workerId: profile.userId } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    Booking.aggregate<{ total: number; month: number; priced: number }>([
      { $match: { workerId: profile.userId, status: BookingStatus.completed } },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$agreedPrice", 0] } },
          month: { $sum: { $cond: [{ $gte: ["$completedAt", monthStart] }, { $ifNull: ["$agreedPrice", 0] }, 0] } },
          priced: { $sum: { $cond: [{ $gt: ["$agreedPrice", 0] }, 1, 0] } },
        },
      },
    ]),
    BookingStrike.find({ userId: profile.userId, role: StrikeRole.worker, liftedAt: { $exists: false }, createdAt: { $gt: new Date(now.getTime() - PENALTY.windowMs) } })
      .sort({ createdAt: -1 })
      .select("tier penalty lessVisibleUntil suspendedUntil limitedUntil createdAt softenedAt")
      .lean(),
  ]);
  const count = (status: BookingStatus) => byStatus.find((b) => b._id === status)?.n ?? 0;
  const active = (date?: Date) => (date && date > now ? date : undefined);
  const penalty = profile.bookingPenalty;

  const peerOf = (c: (typeof recent)[number]) => c.participants.find((p) => String(p.userId) !== String(profile.userId));
  const peerIds = recent.flatMap((c) => {
    const id = peerOf(c)?.userId;
    return id ? [id] : [];
  });
  const peers = await User.find({ _id: { $in: peerIds } })
    .select("name avatar")
    .lean();
  const peerMap = new Map(peers.map((u) => [String(u._id), u]));

  return {
    profileId: profile._id,
    approvalStatus: profile.approvalStatus,
    reviewNote: profile.reviewNote,
    submittedAt: profile.submittedAt,
    isWorkerListed: profile.isWorkerListed,
    /** Shown to customers right now (approved, listed, paid or trial, not suspended) */
    isVisible: isPublicWorker(profile, now),
    listing: {
      listedUntil: profile.listedUntil,
      active: !!profile.listedUntil && profile.listedUntil > now,
      trialUsed: !!profile.trialUsedAt,
    },
    penalty: {
      lessVisibleUntil: active(penalty?.lessVisibleUntil),
      suspendedUntil: active(penalty?.suspendedUntil),
      limitedUntil: active(penalty?.limitedUntil),
      /** Cancellations counted in the last 30 days (latest first) */
      strikes,
    },
    bookings: {
      requested: count(BookingStatus.requested),
      accepted: count(BookingStatus.accepted),
      done: count(BookingStatus.done),
      completed: count(BookingStatus.completed),
    },
    earnings: { total: earned[0]?.total ?? 0, thisMonth: earned[0]?.month ?? 0, pricedJobs: earned[0]?.priced ?? 0 },
    ratingAvg: profile.ratingAvg,
    ratingCount: profile.ratingCount,
    messages: {
      conversations,
      unread: unreadAgg[0]?.unread ?? 0,
      unreadChats: unreadAgg[0]?.unreadChats ?? 0,
    },
    recent: recent.map((c) => {
      const peer = peerOf(c);
      const me = c.participants.find((p) => String(p.userId) === String(profile.userId));
      const user = peer ? peerMap.get(String(peer.userId)) : undefined;
      return {
        _id: c._id,
        peer: user ? { _id: user._id, name: user.name, avatar: user.avatar } : null,
        lastMessage: c.lastMessage,
        unreadCount: me?.unreadCount ?? 0,
      };
    }),
  };
};

/** Admin list (Dashboard → Workers): by status, with counts per status for the tabs. */
const getWorkersForAdmin = async (query: { status?: string; search?: string; page?: number; limit?: number }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  // Only people who applied (a CV alone is not a worker application)
  const filter: Record<string, unknown> = { approvalStatus: { $ne: ApprovalStatus.draft } };
  const status = Object.values(ApprovalStatus).find((s) => s === query.status);
  if (status) filter.approvalStatus = status;
  if (query.search?.trim()) {
    const rx = { $regex: escapeRegex(query.search.trim()), $options: "i" };
    const users = await User.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] }).select("_id").limit(200).lean();
    filter.$or = [{ profession: rx }, { city: rx }, { userId: { $in: users.map((u) => u._id) } }];
  }

  const [data, total, counts] = await Promise.all([
    ProfessionalProfile.find(filter)
      .select("userId profession city photo hourlyRate experienceYears serviceCategoryId approvalStatus submittedAt reviewedAt isWorkerListed ratingAvg ratingCount listedUntil bookingPenalty")
      .populate("userId", "name phone email avatar")
      .populate("serviceCategoryId", "name")
      .sort({ submittedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ProfessionalProfile.countDocuments(filter),
    ProfessionalProfile.aggregate<{ _id: string; n: number }>([
      { $match: { approvalStatus: { $ne: ApprovalStatus.draft } } },
      { $group: { _id: "$approvalStatus", n: { $sum: 1 } } },
    ]),
  ]);
  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) },
    data,
  };
};

const getWorkerForAdmin = async (id: string) => {
  const profile = await ProfessionalProfile.findById(id)
    .populate("userId", "name phone email avatar createdAt")
    .populate("serviceCategoryId", "name")
    .populate("applicationHistory.byUserId", "name");
  if (!profile || profile.approvalStatus === ApprovalStatus.draft) {
    throw new AppError(httpStatus.NOT_FOUND, "WORKER_NOT_FOUND");
  }
  return profile;
};

const reviewWorker = async (id: string, payload: { action: ReviewAction; note?: string }, actorId: string) => {
  const profile = await ProfessionalProfile.findById(id);
  if (!profile) throw new AppError(httpStatus.NOT_FOUND, "WORKER_NOT_FOUND");
  const owner = await User.findOne({ _id: profile.userId, isDeleted: false }).select("_id");
  if (!owner) throw new AppError(httpStatus.BAD_REQUEST, "APPLICANT_ACCOUNT_GONE");

  const before = profile.approvalStatus;
  const status = applyReview(profile, payload.action, payload.note, actorId);
  // First approval: free visibility period starts
  if (status === ApprovalStatus.approved) startTrialIfFirst(profile);
  await profile.save();
  Notify.workerReviewed(profile.userId, status, payload.note);

  await AuditLogServices.record({
    actorId,
    action: `worker.${payload.action}`,
    targetType: "professional_profile",
    targetId: id,
    before: { approvalStatus: before },
    after: { approvalStatus: status, note: payload.note },
  });
  return getWorkerForAdmin(id);
};

/**
 * Workers listed before the approval step existed stay visible: marked approved once.
 * Idempotent; runs at server start.
 */
const approveLegacyListedWorkers = async () => {
  const res = await ProfessionalProfile.updateMany(
    { isWorkerListed: true, approvalStatus: { $exists: false } },
    { $set: { approvalStatus: ApprovalStatus.approved, reviewedAt: new Date() } },
  );
  // Everyone else never applied: a CV only (keeps them out of the admin list)
  await ProfessionalProfile.updateMany({ approvalStatus: { $exists: false } }, { $set: { approvalStatus: ApprovalStatus.draft } });
  // Approved before subscriptions existed: the same free period as a new worker
  await grantListingGrace();
  return res.modifiedCount;
};

export const ProfessionalProfileServices = {
  getMyProfile,
  upsertProfile,
  deleteMyCv,
  toggleWorkerListing,
  submitWorkerApplication,
  getWorkerSummary,
  getWorkersForAdmin,
  getWorkerForAdmin,
  reviewWorker,
  approveLegacyListedWorkers,
  searchWorkers,
  getWorkerById,
  generateAiCv,
};

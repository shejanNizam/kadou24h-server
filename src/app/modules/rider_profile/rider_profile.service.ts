import httpStatus from "http-status";
import { Types } from "mongoose";
import { IFileRef } from "../../interfaces/common.types";
import AppError from "../../errorHelpers/AppError";
import { fromGeoPoint } from "../../utils/commonSchemas";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogServices } from "../audit_log/audit_log.service";
import {
  ApprovalStatus,
  applyReview,
  assertEditable,
  DocumentStatus,
  IVerificationDocument,
  markSubmitted,
  ReviewAction,
  syncRole,
} from "../profile_common/profile.common";
import { TransitStationServices } from "../transit_station/transit_station.service";
import { UserRole } from "../user/user.interface";
import { User } from "../user/user.model";
import { WalletMode } from "../wallet/wallet.interface";
import { WalletServices, walletSummary } from "../wallet/wallet.service";
import {
  IRiderProfile,
  IVehicle,
  missingSafetyIds,
  PartnerType,
  VEHICLES_BY_PARTNER,
} from "./rider_profile.interface";
import { RiderProfile } from "./rider_profile.model";
import { Notify } from "../notification/notification.events";

interface RiderInput {
  partnerType?: PartnerType;
  vehicle?: IVehicle;
  vestNumber?: string;
  cityArea?: string;
  nationalIdNumber?: string;
  transitRoutes?: { fromStationId: string; toStationId: string }[];
  documents?: { type: string; file: IFileRef }[];
}

// Shown to vendors looking for riders — no phone, no national id
const PUBLIC_FIELDS =
  "userId partnerType vehicle.type vehicle.color vehicle.brand cityArea transitRoutes isOnline stats createdAt";

const present = (profile: IRiderProfile | Record<string, unknown>) => {
  const obj = (
    "toObject" in profile && typeof profile.toObject === "function" ? profile.toObject() : profile
  ) as IRiderProfile;
  return { ...obj, lastLocation: fromGeoPoint(obj.lastLocation) };
};

const applyRiderInput = async (profile: IRiderProfile, payload: RiderInput) => {
  const { vehicle, transitRoutes, documents, ...rest } = payload;
  profile.set(rest);

  if (vehicle) profile.set("vehicle", { ...profile.toObject().vehicle, ...vehicle });

  if (transitRoutes) {
    await TransitStationServices.assertStations(
      transitRoutes.flatMap((r) => [r.fromStationId, r.toStationId]),
    );
    profile.set(
      "transitRoutes",
      transitRoutes.map((r) => ({
        fromStationId: new Types.ObjectId(r.fromStationId),
        toStationId: new Types.ObjectId(r.toStationId),
      })),
    );
  }

  if (documents) {
    const previous = profile.documents.map((d) => d.toObject() as IVerificationDocument);
    profile.set(
      "documents",
      documents.map((doc) => {
        const same = previous.find((p) => p.type === doc.type && p.file.url === doc.file.url);
        return same ?? { ...doc, status: DocumentStatus.pending };
      }),
    );
  }

  // Vehicle must fit the partner type (no bicycle bus drivers)
  if (profile.partnerType && profile.vehicle?.type) {
    if (!VEHICLES_BY_PARTNER[profile.partnerType].includes(profile.vehicle.type)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "VEHICLE_NOT_ALLOWED", { partnerType: profile.partnerType },
      );
    }
  }
};

const findMyProfile = async (userId: string) => {
  const profile = await RiderProfile.findOne({ userId });
  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "RIDER_APPLICATION_NOT_STARTED");
  }
  return profile;
};

// ──────────────────────────────
// Applicant / rider
// ──────────────────────────────

const getMyRiderProfile = async (userId: string) => {
  const profile = await findMyProfile(userId);
  await profile.populate("transitRoutes.fromStationId transitRoutes.toStationId", "name city");
  return present(profile);
};

const saveApplication = async (userId: string, payload: RiderInput) => {
  let profile = await RiderProfile.findOne({ userId });

  if (!profile) {
    profile = new RiderProfile({ userId });
    await WalletServices.ensureWallet(userId, WalletMode.rider);
  } else {
    assertEditable(profile);
  }

  await applyRiderInput(profile, payload);
  await profile.save();
  return present(profile);
};

/**
 * "Supprimer la demande" (client, 2026-11-25): a draft never sent can be thrown away, so the
 * profile shows "Devenir livreur" again. Once sent (reviewed, approved…) it stays.
 */
const deleteDraftApplication = async (userId: string) => {
  const deleted = await RiderProfile.findOneAndDelete({ userId, approvalStatus: ApprovalStatus.draft });
  if (deleted) return;
  const exists = await RiderProfile.exists({ userId });
  throw exists
    ? new AppError(httpStatus.BAD_REQUEST, "RIDER_APPLICATION_NOT_DRAFT")
    : new AppError(httpStatus.NOT_FOUND, "RIDER_APPLICATION_NOT_STARTED");
};

const submitApplication = async (userId: string) => {
  const profile = await findMyProfile(userId);

  const missing = [
    !profile.partnerType && "partnerType",
    !profile.vehicle?.type && "vehicle.type",
    !profile.cityArea && "cityArea",
    !profile.nationalIdNumber && "nationalIdNumber",
    profile.partnerType === PartnerType.transit &&
      profile.transitRoutes.length === 0 &&
      "transitRoutes (at least one route)",
    ...missingSafetyIds(profile),
  ].filter(Boolean);

  if (missing.length) {
    throw new AppError(httpStatus.BAD_REQUEST, "APPLICATION_INCOMPLETE", { fields: missing.join(", ") });
  }

  markSubmitted(profile, userId);
  await profile.save();
  return present(profile);
};

const updateMyRiderProfile = async (userId: string, payload: RiderInput) => {
  const profile = await findMyProfile(userId);
  if (profile.approvalStatus !== ApprovalStatus.approved) {
    throw new AppError(httpStatus.FORBIDDEN, "RIDER_NOT_APPROVED");
  }
  if (payload.transitRoutes && profile.partnerType !== PartnerType.transit) {
    throw new AppError(httpStatus.BAD_REQUEST, "TRANSIT_ROUTES_ONLY_DRIVERS");
  }
  await applyRiderInput(profile, payload);
  // Can't be cleared once approved (riders approved before the rule fill them in here)
  const missing = missingSafetyIds(profile);
  if (missing.length) {
    throw new AppError(httpStatus.BAD_REQUEST, "APPLICATION_INCOMPLETE", { fields: missing.join(", ") });
  }
  await profile.save();
  return present(profile);
};

// ──────────────────────────────
// Vendor: find riders to invite
// ──────────────────────────────

const searchRiders = async (query: Record<string, string>) => {
  const filter: Record<string, unknown> = {
    approvalStatus: ApprovalStatus.approved,
    partnerType: query.partnerType ?? PartnerType.moto,
  };
  if (query.cityArea) filter.cityArea = new RegExp(query.cityArea.replace(/[.*+?^${}()|[\]\\]/g, ""), "i");

  // Name (partial) or exact phone — the phone itself is never returned
  if (query.searchTerm) {
    const term = query.searchTerm.trim();
    const users = await User.find({
      roles: UserRole.rider,
      isDeleted: false,
      $or: [
        { name: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, ""), $options: "i" } },
        { phone: term.replace(/[\s-]/g, "") },
      ],
    })
      .select("_id")
      .limit(200)
      .lean();
    filter.userId = { $in: users.map((u) => u._id) };
  }

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Number(query.limit) || 20, 50);

  const [riders, total] = await Promise.all([
    RiderProfile.find(filter)
      .select(PUBLIC_FIELDS)
      .populate("userId", "name avatar")
      .sort({ isOnline: -1, "stats.ratingAvg": -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RiderProfile.countDocuments(filter),
  ]);

  return { data: riders, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
};

// ──────────────────────────────
// Admin
// ──────────────────────────────

const getRidersForAdmin = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(RiderProfile.find().select("-applicationHistory"), query);

  const riders = await queryBuilder
    .search(["cityArea", "vestNumber", "nationalIdNumber", "vehicle.plateNumber"])
    .filter()
    .sort()
    .paginate()
    .build()
    .populate("userId", "name phone email avatar status")
    .lean();

  const meta = await queryBuilder.getMeta();
  return { data: riders.map(present), meta };
};

const getRiderForAdmin = async (id: string) => {
  const base = await RiderProfile.findById(id).select("userId").lean();
  if (!base) throw new AppError(httpStatus.NOT_FOUND, "PARTNER_NOT_FOUND");

  const [rider, wallet] = await Promise.all([
    RiderProfile.findById(id)
      .populate("userId", "name phone email avatar status createdAt")
      .populate("transitRoutes.fromStationId transitRoutes.toStationId", "name city")
      .populate("applicationHistory.byUserId", "name roles")
      .lean(),
    WalletServices.ensureWallet(base.userId, WalletMode.rider),
  ]);

  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "PARTNER_NOT_FOUND");
  return {
    ...present(rider),
    payoutMethods: wallet.payoutMethods,
    cashOwed: wallet.cashOwed,
    wallet: walletSummary(wallet),
  };
};

const reviewDocument = async (
  id: string,
  docId: string,
  payload: { status: DocumentStatus; note?: string },
  actorId: string,
) => {
  const rider = await RiderProfile.findById(id);
  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "PARTNER_NOT_FOUND");
  const doc = rider.documents.id(docId);
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, "DOCUMENT_NOT_FOUND");

  doc.status = payload.status;
  doc.note = payload.note;
  await rider.save();

  await AuditLogServices.record({
    actorId,
    action: `rider.document.${payload.status}`,
    targetType: "rider_profile",
    targetId: id,
    after: { documentId: docId, type: doc.type, ...payload },
  });
  return present(rider);
};

const reviewApplication = async (
  id: string,
  payload: { action: ReviewAction; note?: string },
  actorId: string,
) => {
  const rider = await RiderProfile.findById(id);
  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "PARTNER_NOT_FOUND");

  const owner = await User.findOne({ _id: rider.userId, isDeleted: false });
  if (!owner) throw new AppError(httpStatus.BAD_REQUEST, "APPLICANT_ACCOUNT_GONE");

  const before = rider.approvalStatus;
  const status = applyReview(rider, payload.action, payload.note, actorId);
  if (status !== ApprovalStatus.approved) rider.isOnline = false;
  await rider.save();

  await syncRole(rider.userId, UserRole.rider, status);
  Notify.profileReviewed(rider.userId, "rider", status, payload.note);

  await AuditLogServices.record({
    actorId,
    action: `rider.${payload.action}`,
    targetType: "rider_profile",
    targetId: id,
    before: { approvalStatus: before },
    after: { approvalStatus: status, note: payload.note },
  });
  return present(rider);
};

export const RiderProfileServices = {
  getMyRiderProfile,
  saveApplication,
  submitApplication,
  deleteDraftApplication,
  updateMyRiderProfile,
  searchRiders,
  getRidersForAdmin,
  getRiderForAdmin,
  reviewDocument,
  reviewApplication,
};

import httpStatus from "http-status";
import { Types } from "mongoose";
import { IFileRef, ILatLng } from "../../interfaces/common.types";
import AppError from "../../errorHelpers/AppError";
import { fromGeoPoint, toGeoPoint } from "../../utils/commonSchemas";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogServices } from "../audit_log/audit_log.service";
import { CategoryType } from "../category/category.interface";
import { CategoryServices } from "../category/category.service";
import {
  ApprovalStatus,
  applyReview,
  assertEditable,
  DocumentStatus,
  IVerificationDocument,
  markSubmitted,
  notifyApplicant,
  ReviewAction,
  syncRole,
} from "../profile_common/profile.common";
import { UserRole } from "../user/user.interface";
import { User } from "../user/user.model";
import { WalletMode } from "../wallet/wallet.interface";
import { WalletServices } from "../wallet/wallet.service";
import { IStoreAvailability, IVendorProfile } from "./vendor_profile.interface";
import { VendorProfile } from "./vendor_profile.model";

interface StoreInput {
  storeName?: string;
  logo?: IFileRef;
  businessCategoryId?: string;
  marketName?: string;
  businessPhone?: string;
  businessEmail?: string;
  address?: { text?: string; city?: string; country?: string; location?: ILatLng };
  documents?: { type: string; file: IFileRef }[];
}

// What customers / riders may see — never phone or email (anti off-platform deals)
const PUBLIC_FIELDS =
  "userId storeName logo businessCategoryId marketName address isOpen availability stats isPlatformStore createdAt";

/** API shape: address.location as { lat, lng }. */
const present = (profile: IVendorProfile | Record<string, unknown>) => {
  const obj = (
    "toObject" in profile && typeof profile.toObject === "function" ? profile.toObject() : profile
  ) as IVendorProfile;
  return {
    ...obj,
    address: obj.address && { ...obj.address, location: fromGeoPoint(obj.address.location) },
  };
};

const applyStoreInput = async (profile: IVendorProfile, payload: StoreInput) => {
  const { address, documents, businessCategoryId, ...rest } = payload;
  profile.set(rest);

  if (businessCategoryId) {
    await CategoryServices.assertCategory(businessCategoryId, CategoryType.business);
    profile.businessCategoryId = new Types.ObjectId(businessCategoryId);
  }

  if (address) {
    const { location, ...addressRest } = address;
    profile.set("address", {
      ...profile.toObject().address,
      ...addressRest,
      ...(location && { location: toGeoPoint(location) }),
    });
  }

  if (documents) {
    // Re-sent files keep their review status; new files start as pending
    const previous = profile.documents.map((d) => d.toObject() as IVerificationDocument);
    profile.set(
      "documents",
      documents.map((doc) => {
        const same = previous.find((p) => p.type === doc.type && p.file.url === doc.file.url);
        return same ?? { ...doc, status: DocumentStatus.pending };
      }),
    );
  }
};

const findMyProfile = async (userId: string) => {
  const profile = await VendorProfile.findOne({ userId });
  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "You have not started a vendor application");
  }
  return profile;
};

// ──────────────────────────────
// Applicant / vendor
// ──────────────────────────────

const getMyVendorProfile = async (userId: string) => present(await findMyProfile(userId));

/** Creates or updates the draft. Allowed while draft / needs_changes / rejected. */
const saveApplication = async (userId: string, payload: StoreInput) => {
  let profile = await VendorProfile.findOne({ userId });

  if (!profile) {
    profile = new VendorProfile({ userId });
    await WalletServices.ensureWallet(userId, WalletMode.vendor);
  } else {
    assertEditable(profile);
  }

  await applyStoreInput(profile, payload);
  await profile.save();
  return present(profile);
};

const submitApplication = async (userId: string) => {
  const profile = await findMyProfile(userId);
  const wallet = await WalletServices.ensureWallet(userId, WalletMode.vendor);

  const missing = [
    !profile.storeName && "storeName",
    !profile.businessCategoryId && "businessCategoryId",
    !profile.businessPhone && "businessPhone",
    !profile.address?.city && "address.city",
    !profile.address?.location && "address.location",
    wallet.payoutMethods.length === 0 && "payout method (POST /wallets/me/payout-methods)",
  ].filter(Boolean);

  if (missing.length) {
    throw new AppError(httpStatus.BAD_REQUEST, `Please complete: ${missing.join(", ")}`);
  }

  markSubmitted(profile, userId);
  await profile.save();
  return present(profile);
};

const assertApproved = (profile: IVendorProfile) => {
  if (profile.approvalStatus !== ApprovalStatus.approved) {
    throw new AppError(httpStatus.FORBIDDEN, "Your store is not approved");
  }
};

const updateMyStore = async (userId: string, payload: StoreInput) => {
  const profile = await findMyProfile(userId);
  assertApproved(profile);
  await applyStoreInput(profile, payload);
  await profile.save();
  return present(profile);
};

const updateAvailability = async (
  userId: string,
  payload: { isOpen?: boolean; availability?: Partial<IStoreAvailability> },
) => {
  const profile = await findMyProfile(userId);
  assertApproved(profile);

  if (payload.isOpen !== undefined) profile.isOpen = payload.isOpen;
  if (payload.availability) {
    profile.set("availability", { ...profile.toObject().availability, ...payload.availability });
  }
  const { openTime, closeTime } = profile.availability;
  if (openTime >= closeTime) {
    throw new AppError(httpStatus.BAD_REQUEST, "openTime must be before closeTime");
  }

  await profile.save();
  return { isOpen: profile.isOpen, availability: profile.availability };
};

// ──────────────────────────────
// Public
// ──────────────────────────────

const getPublicVendors = async (query: Record<string, string>) => {
  const filter: Record<string, unknown> = { approvalStatus: ApprovalStatus.approved };
  if (query.city) filter["address.city"] = query.city;
  if (query.categoryId) filter.businessCategoryId = query.categoryId;
  if (query.isOpen) filter.isOpen = query.isOpen === "true";

  // No .filter(): only the whitelisted filters above may reach the query
  const queryBuilder = new QueryBuilder(VendorProfile.find(filter).select(PUBLIC_FIELDS), query);

  const vendors = await queryBuilder
    .search(["storeName", "marketName"])
    .sort()
    .paginate()
    .build()
    .populate("businessCategoryId", "name slug")
    .lean();

  const meta = await queryBuilder.getMeta();
  return { data: vendors.map(present), meta };
};

const getPublicVendor = async (id: string) => {
  const vendor = await VendorProfile.findOne({ _id: id, approvalStatus: ApprovalStatus.approved })
    .select(PUBLIC_FIELDS)
    .populate("businessCategoryId", "name slug")
    .lean();
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Store not found");
  return present(vendor);
};

// ──────────────────────────────
// Admin
// ──────────────────────────────

const getVendorsForAdmin = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(VendorProfile.find().select("-applicationHistory"), query);

  const vendors = await queryBuilder
    .search(["storeName", "marketName", "businessPhone"])
    .filter()
    .sort()
    .paginate()
    .build()
    .populate("userId", "name phone email avatar status")
    .populate("businessCategoryId", "name")
    .lean();

  const meta = await queryBuilder.getMeta();
  return { data: vendors.map(present), meta };
};

const getVendorForAdmin = async (id: string) => {
  const base = await VendorProfile.findById(id).select("userId").lean();
  if (!base) throw new AppError(httpStatus.NOT_FOUND, "Vendor not found");

  const [vendor, wallet] = await Promise.all([
    VendorProfile.findById(id)
      .populate("userId", "name phone email avatar status createdAt")
      .populate("businessCategoryId", "name")
      .populate("applicationHistory.byUserId", "name roles")
      .lean(),
    WalletServices.ensureWallet(base.userId, WalletMode.vendor),
  ]);

  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Vendor not found");
  return { ...present(vendor), payoutMethods: wallet.payoutMethods };
};

const reviewDocument = async (
  id: string,
  docId: string,
  payload: { status: DocumentStatus; note?: string },
  actorId: string,
) => {
  const vendor = await VendorProfile.findById(id);
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Vendor not found");
  const doc = vendor.documents.id(docId);
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, "Document not found");

  doc.status = payload.status;
  doc.note = payload.note;
  await vendor.save();

  await AuditLogServices.record({
    actorId,
    action: `vendor.document.${payload.status}`,
    targetType: "vendor_profile",
    targetId: id,
    after: { documentId: docId, type: doc.type, ...payload },
  });
  return present(vendor);
};

const reviewApplication = async (
  id: string,
  payload: { action: ReviewAction; note?: string },
  actorId: string,
) => {
  const vendor = await VendorProfile.findById(id);
  if (!vendor) throw new AppError(httpStatus.NOT_FOUND, "Vendor not found");

  const owner = await User.findOne({ _id: vendor.userId, isDeleted: false });
  if (!owner) throw new AppError(httpStatus.BAD_REQUEST, "The applicant's account no longer exists");

  const before = vendor.approvalStatus;
  const status = applyReview(vendor, payload.action, payload.note, actorId);
  await vendor.save();

  await syncRole(vendor.userId, UserRole.vendor, status);
  notifyApplicant(vendor.userId, "vendor", status, payload.note);

  await AuditLogServices.record({
    actorId,
    action: `vendor.${payload.action}`,
    targetType: "vendor_profile",
    targetId: id,
    before: { approvalStatus: before },
    after: { approvalStatus: status, note: payload.note },
  });
  return present(vendor);
};

export const VendorProfileServices = {
  getMyVendorProfile,
  saveApplication,
  submitApplication,
  updateMyStore,
  updateAvailability,
  getPublicVendors,
  getPublicVendor,
  getVendorsForAdmin,
  getVendorForAdmin,
  reviewDocument,
  reviewApplication,
};

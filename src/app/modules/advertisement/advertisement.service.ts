import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { AuditLogServices } from "../audit_log/audit_log.service";
import {
  AdPlacement,
  AdStatus,
  AdType,
  IAdvertisement,
} from "./advertisement.interface";
import { Advertisement } from "./advertisement.model";
import { containsRegex } from "../../utils/queryParams";

interface ICreateAdPayload {
  name: string;
  advertiserName: string;
  type?: AdType;
  placement: AdPlacement;
  images: string[];
  linkUrl?: string;
  description?: string;
  startAt: string | Date;
  endAt: string | Date;
  status?: AdStatus;
}

const getActiveAds = async (placement?: string): Promise<IAdvertisement[]> => {
  const now = new Date();
  const filter: Record<string, unknown> = {
    status: AdStatus.active,
    startAt: { $lte: now },
    endAt: { $gte: now },
  };

  if (placement) {
    filter.placement = placement;
  }

  const ads = await Advertisement.find(filter).sort({ createdAt: -1 }).lean();
  return ads as unknown as IAdvertisement[];
};

const recordImpression = async (adId: string) => {
  await Advertisement.findByIdAndUpdate(adId, { $inc: { impressions: 1 } });
  return { success: true };
};

const recordClick = async (adId: string) => {
  const ad = await Advertisement.findByIdAndUpdate(
    adId,
    { $inc: { clicks: 1 } },
    { returnDocument: "after" },
  );

  if (!ad) {
    throw new AppError(404, "AD_NOT_FOUND");
  }

  return {
    success: true,
    linkUrl: ad.linkUrl,
    clicks: ad.clicks,
  };
};

const createAdAdmin = async (
  adminId: string,
  payload: ICreateAdPayload,
): Promise<IAdvertisement> => {
  const startDate = new Date(payload.startAt);
  const endDate = new Date(payload.endAt);

  if (endDate <= startDate) {
    throw new AppError(400, "END_DATE_BEFORE_START");
  }

  const ad = await Advertisement.create({
    ...payload,
    startAt: startDate,
    endAt: endDate,
    type: payload.type || AdType.banner,
    status: payload.status || AdStatus.active,
    createdBy: new Types.ObjectId(adminId),
  });

  await AuditLogServices.record({
    actorId: adminId,
    action: "advertisement.create",
    targetType: "advertisement",
    targetId: ad._id.toString(),
    after: { name: ad.name, advertiserName: ad.advertiserName, placement: ad.placement },
  });

  return ad;
};

const getAllAdsAdmin = async (query: {
  status?: string;
  placement?: string;
  search?: string;
  page?: number;
  limit?: number;
}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.placement) filter.placement = query.placement;
  if (query.search) {
    filter.$or = [
      { name: containsRegex(query.search) },
      { advertiserName: containsRegex(query.search) },
    ];
  }

  const [docs, total, totals] = await Promise.all([
    Advertisement.find(filter)
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Advertisement.countDocuments(filter),
    // Whole-platform totals for the dashboard cards (not just this page)
    Advertisement.aggregate<{ impressions: number; clicks: number; active: number }>([
      {
        $group: {
          _id: null,
          impressions: { $sum: "$impressions" },
          clicks: { $sum: "$clicks" },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const summary = totals[0] ?? { impressions: 0, clicks: 0, active: 0 };

  const data = docs.map((ad) => {
    const impressions = ad.impressions || 0;
    const clicks = ad.clicks || 0;
    const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;
    return {
      ...ad,
      ctr,
    };
  });

  return {
    meta: {
      page,
      limit,
      total,
      summary: {
        impressions: summary.impressions,
        clicks: summary.clicks,
        active: summary.active,
        ctr: summary.impressions > 0 ? Number(((summary.clicks / summary.impressions) * 100).toFixed(2)) : 0,
      },
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const getAdByIdAdmin = async (adId: string): Promise<IAdvertisement> => {
  const ad = await Advertisement.findById(adId).populate("createdBy", "name email");
  if (!ad) {
    throw new AppError(404, "AD_NOT_FOUND");
  }
  return ad;
};

const updateAdAdmin = async (
  adminId: string,
  adId: string,
  payload: Partial<ICreateAdPayload>,
): Promise<IAdvertisement> => {
  const ad = await Advertisement.findById(adId);
  if (!ad) {
    throw new AppError(404, "AD_NOT_FOUND");
  }

  const before = ad.toObject();

  if (payload.startAt) ad.startAt = new Date(payload.startAt);
  if (payload.endAt) ad.endAt = new Date(payload.endAt);
  if (payload.name) ad.name = payload.name;
  if (payload.advertiserName) ad.advertiserName = payload.advertiserName;
  if (payload.type) ad.type = payload.type;
  if (payload.placement) ad.placement = payload.placement;
  if (payload.images) ad.images = payload.images;
  if (payload.linkUrl !== undefined) ad.linkUrl = payload.linkUrl;
  if (payload.description !== undefined) ad.description = payload.description;
  if (payload.status) ad.status = payload.status;

  if (ad.endAt <= ad.startAt) {
    throw new AppError(400, "END_DATE_BEFORE_START");
  }

  await ad.save();

  await AuditLogServices.record({
    actorId: adminId,
    action: "advertisement.update",
    targetType: "advertisement",
    targetId: ad._id.toString(),
    before: JSON.parse(JSON.stringify(before)),
    after: JSON.parse(JSON.stringify(ad.toObject())),
  });

  return ad;
};

const deleteAdAdmin = async (adminId: string, adId: string) => {
  const ad = await Advertisement.findByIdAndDelete(adId);
  if (!ad) {
    throw new AppError(404, "AD_NOT_FOUND");
  }

  await AuditLogServices.record({
    actorId: adminId,
    action: "advertisement.delete",
    targetType: "advertisement",
    targetId: adId,
    before: JSON.parse(JSON.stringify(ad.toObject())),
  });

  return { success: true };
};

export const AdvertisementServices = {
  getActiveAds,
  recordImpression,
  recordClick,
  createAdAdmin,
  getAllAdsAdmin,
  getAdByIdAdmin,
  updateAdAdmin,
  deleteAdAdmin,
};

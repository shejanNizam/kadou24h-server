import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { IProfessionalProfile } from "./professional_profile.interface";
import { ProfessionalProfile } from "./professional_profile.model";
import { escapeRegex } from "../../utils/queryParams";

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

  // null = remove the file (photo, uploaded CV, generated CV)
  for (const key of ["photo", "uploadedResume", "generatedCv"] as const) {
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

  const filter: Record<string, unknown> = { isWorkerListed: true };

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

  const [workers, total] = await Promise.all([
    ProfessionalProfile.find(filter)
      // Public endpoint: never phone / email (contact goes through in-app chat)
      .populate("userId", "name avatar")
      .populate("serviceCategoryId", "name slug")
      // Subscribers ("priority search visibility") first, then by rating
      .sort({ cvVisible: -1, ratingAvg: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ProfessionalProfile.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
    data: workers.map((w) => ({ ...w.toObject(), isPremium: w.cvVisible })),
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
  const profile = await ProfessionalProfile.findById(profileId)
    .populate("userId", "name avatar")
    .populate("serviceCategoryId", "name slug");

  if (!profile || !profile.isWorkerListed) {
    throw new AppError(httpStatus.NOT_FOUND, "Worker profile not found");
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

export const ProfessionalProfileServices = {
  getMyProfile,
  upsertProfile,
  toggleWorkerListing,
  searchWorkers,
  getWorkerById,
  generateAiCv,
};

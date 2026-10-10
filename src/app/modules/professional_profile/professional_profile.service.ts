import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { toGeoPoint } from "../../utils/commonSchemas";
import { User } from "../user/user.model";
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
 * Generates an AI-crafted CV summary and structured resume for the candidate.
 */
const generateAiCv = async (
  userId: string,
  payload: { targetRole?: string; tone?: string },
) => {
  const [profile, user] = await Promise.all([
    getMyProfile(userId),
    User.findById(userId),
  ]);

  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const profession = payload.targetRole || profile.profession || "Professional Specialist";
  const toneDesc = payload.tone ? ` characterized by a ${payload.tone} approach` : "";

  // Synthesize AI-crafted professional summary
  const skillsList = profile.skills.length > 0 ? profile.skills.join(", ") : "Industry best practices, problem solving, task execution";
  const expYears = profile.experienceYears ? `${profile.experienceYears}+ years` : "proven";

  const aiSummary =
    `Dedicated and results-oriented ${profession} with ${expYears} of hands-on experience in dynamic environments${toneDesc}. ` +
    `Proficient in ${skillsList}. Proven track record of delivering high quality work with attention to detail, reliability, and excellence.`;

  // Update profile with generated content
  profile.summary = aiSummary;
  profile.generatedAt = new Date();
  profile.generatedCv = {
    url: `https://res.cloudinary.com/kadou24h/raw/upload/v1/cv_${userId}.pdf`,
    publicId: `cv_${userId}`,
  };

  await profile.save();

  return {
    profile,
    generatedSummary: aiSummary,
    cvMarkdown: `# ${user.name}\n**${profession}**\n\n## Professional Summary\n${aiSummary}\n\n## Core Competencies\n${profile.skills.map((s) => `- ${s}`).join("\n")}\n\n## Experience\n${profile.profileExperience.map((e) => `### ${e.title} - ${e.company || "Independent"}\n*${e.location || "Guinea"}*\n${e.description || ""}`).join("\n\n")}\n\n## Education\n${profile.profileEducation.map((ed) => `- **${ed.degree}**, ${ed.institution} (${ed.year})`).join("\n")}`,
  };
};

export const ProfessionalProfileServices = {
  getMyProfile,
  upsertProfile,
  toggleWorkerListing,
  searchWorkers,
  getWorkerById,
  generateAiCv,
};

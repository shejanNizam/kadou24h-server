import z from "zod";

const fileRefZod = z.object({
  url: z.string().url(),
  publicId: z.string(),
});

const educationZod = z.object({
  degree: z.string().trim().min(1, "FIELD_REQUIRED"),
  institution: z.string().trim().min(1, "FIELD_REQUIRED"),
  year: z.string().trim().min(4).max(10),
});

const experienceZod = z.object({
  title: z.string().trim().min(1, "FIELD_REQUIRED"),
  company: z.string().trim().optional(),
  location: z.string().trim().optional(),
  startDate: z.string().or(z.date()).optional(),
  endDate: z.string().or(z.date()).optional(),
  isCurrent: z.boolean().optional(),
  description: z.string().trim().optional(),
});

export const upsertProfileSchema = z.object({
  profession: z.string().trim().min(2).max(100).optional(),
  summary: z.string().trim().max(2000).optional(),
  photo: fileRefZod.nullable().optional(),
  city: z.string().trim().optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  // null removes the file
  uploadedResume: fileRefZod.nullable().optional(),
  // The CV PDF the app made from this profile (uploaded first)
  generatedCv: fileRefZod.nullable().optional(),
  skills: z.array(z.string().trim().min(1)).optional(),
  languages: z.array(z.string().trim().min(1)).optional(),
  achievements: z.array(z.string().trim().min(1)).optional(),
  profileEducation: z.array(educationZod).optional(),
  profileExperience: z.array(experienceZod).optional(),
  hourlyRate: z.number().min(0).optional(),
  experienceYears: z.number().min(0).max(60).optional(),
  serviceCategoryId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID")
    .optional(),
  // Worker profile: null clears it
  workingHours: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).max(7),
      from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "TIME_FORMAT"),
      to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "TIME_FORMAT"),
    })
    .nullable()
    .optional(),
  idDocument: fileRefZod.nullable().optional(),
  workPhotos: z.array(fileRefZod).max(10, "WORK_PHOTOS_TOO_MANY").optional(),
});

export const toggleWorkerListingSchema = z.object({
  isWorkerListed: z.boolean(),
  hourlyRate: z.number().min(0).optional(),
  experienceYears: z.number().min(0).max(60).optional(),
  serviceCategoryId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "INVALID_ID")
    .optional(),
});

export const generateAiCvSchema = z.object({
  targetRole: z.string().trim().optional(),
  tone: z.enum(["professional", "technical", "executive", "creative"]).optional(),
  lang: z.enum(["fr", "en"]).optional(),
});

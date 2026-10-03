import { model, Schema } from "mongoose";
import { fileRefSchema, geoPointSchema } from "../../utils/commonSchemas";
import {
  IProfessionalProfile,
  IProfileEducation,
  IProfileExperience,
} from "./professional_profile.interface";

const profileEducationSchema = new Schema<IProfileEducation>({
  degree: { type: String, required: true, trim: true },
  institution: { type: String, required: true, trim: true },
  year: { type: String, required: true, trim: true },
});

const profileExperienceSchema = new Schema<IProfileExperience>({
  title: { type: String, required: true, trim: true },
  company: { type: String, trim: true },
  location: { type: String, trim: true },
  startDate: { type: Date },
  endDate: { type: Date },
  isCurrent: { type: Boolean, default: false },
  description: { type: String, trim: true },
});

const professionalProfileSchema = new Schema<IProfessionalProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    profession: { type: String, trim: true },
    summary: { type: String, trim: true },
    photo: { type: fileRefSchema },
    city: { type: String, trim: true },
    location: { type: geoPointSchema },
    uploadedResume: { type: fileRefSchema },
    generatedCv: { type: fileRefSchema },
    generatedAt: { type: Date },
    skills: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    achievements: { type: [String], default: [] },
    profileEducation: { type: [profileEducationSchema], default: [] },
    profileExperience: { type: [profileExperienceSchema], default: [] },
    isWorkerListed: { type: Boolean, default: false },
    hourlyRate: { type: Number, min: 0 },
    experienceYears: { type: Number, min: 0 },
    serviceCategoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    cvVisible: { type: Boolean, default: false },
    visibleUntil: { type: Date },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

professionalProfileSchema.index({ isWorkerListed: 1, serviceCategoryId: 1 });
professionalProfileSchema.index({ cvVisible: 1, visibleUntil: 1 });
professionalProfileSchema.index({ location: "2dsphere" });
professionalProfileSchema.index(
  { profession: "text", summary: "text", skills: "text" },
  { weights: { profession: 10, skills: 5, summary: 1 } },
);

export const ProfessionalProfile = model<IProfessionalProfile>(
  "ProfessionalProfile",
  professionalProfileSchema,
);

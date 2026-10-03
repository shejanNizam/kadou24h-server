import { Document, Types } from "mongoose";
import { IFileRef, IGeoPoint } from "../../interfaces/common.types";

export interface IProfileEducation {
  _id?: Types.ObjectId;
  degree: string;
  institution: string;
  year: string;
}

export interface IProfileExperience {
  _id?: Types.ObjectId;
  title: string;
  company?: string;
  location?: string;
  startDate?: Date;
  endDate?: Date;
  isCurrent: boolean;
  description?: string;
}

export interface IProfessionalProfileInitial {
  userId: Types.ObjectId;
  profession?: string;
  summary?: string;
  photo?: IFileRef;
  city?: string;
  location?: IGeoPoint;
  uploadedResume?: IFileRef;
  generatedCv?: IFileRef;
  generatedAt?: Date;
  skills: string[];
  languages: string[];
  achievements: string[];
  profileEducation: IProfileEducation[];
  profileExperience: IProfileExperience[];
  isWorkerListed: boolean;
  hourlyRate?: number;
  experienceYears?: number;
  serviceCategoryId?: Types.ObjectId;
  cvVisible: boolean;
  visibleUntil?: Date;
  ratingAvg: number;
  ratingCount: number;
}

export type IProfessionalProfile = IProfessionalProfileInitial & Document;

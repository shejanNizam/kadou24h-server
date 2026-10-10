import z from "zod";
import {
  ApplicationStatus,
  JobType,
  SalaryFrequency,
  WorkplaceType,
} from "./job.interface";
import { PaymentMethod } from "../payment/payment.interface";

const fileRefZod = z.object({
  url: z.string().url(),
  publicId: z.string(),
});

export const createJobSchema = z.object({
  organizationName: z.string().trim().min(2).max(100),
  organizationLogo: fileRefZod.optional(),
  title: z.string().trim().min(3).max(120),
  categoryId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Valid categoryId required")
    .optional(),
  jobType: z.enum(Object.values(JobType) as [string, ...string[]]),
  workplace: z.enum(Object.values(WorkplaceType) as [string, ...string[]]),
  country: z.string().trim().optional(),
  city: z.string().trim().optional(),
  area: z.string().trim().optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  salaryCurrency: z.string().trim().default("GNF"),
  salaryMin: z.number().min(0).optional(),
  salaryMax: z.number().min(0).optional(),
  salaryFrequency: z
    .enum(Object.values(SalaryFrequency) as [string, ...string[]])
    .optional(),
  about: z.string().trim().min(10).max(4000),
  responsibilities: z.array(z.string().trim().min(1)).optional(),
  requirements: z.array(z.string().trim().min(1)).optional(),
  benefits: z.array(z.string().trim().min(1)).optional(),
  aboutCompany: z.string().trim().optional(),
  prefExperienceLevel: z.string().trim().optional(),
  prefMinEducation: z.string().trim().optional(),
  prefSkills: z.array(z.string().trim().min(1)).optional(),
  prefLanguages: z.array(z.string().trim().min(1)).optional(),
  applicationDeadline: z.string().or(z.date()).optional(),
  vacancies: z.number().int().min(1).optional(),
  notificationEmail: z.string().email().optional(),
});

// Without the salaryCurrency default: a partial update must not reset stored values
export const updateJobSchema = createJobSchema
  .extend({ salaryCurrency: z.string().trim() })
  .partial();

export const publishJobSchema = z.object({
  paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
});

export const applyJobSchema = z.object({
  jobId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Valid jobId required"),
  resume: fileRefZod.optional(),
  coverNote: z.string().trim().max(1000).optional(),
});

export const applySpontaneousSchema = z.object({
  targetVendorId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Valid targetVendorId required"),
  resume: fileRefZod.optional(),
  coverNote: z.string().trim().max(1000).optional(),
  paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]),
});

export const updateApplicationStatusSchema = z.object({
  status: z.enum(Object.values(ApplicationStatus) as [string, ...string[]]),
});

export const scheduleInterviewSchema = z.object({
  at: z.string().or(z.date()),
  location: z.string().trim().optional(),
  mapUrl: z.string().url().optional(),
  note: z.string().trim().optional(),
});

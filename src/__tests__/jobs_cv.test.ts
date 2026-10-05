import request from "supertest";
import app from "../app";
import { JobServices } from "../app/modules/job/job.service";
import { ProfessionalProfileServices } from "../app/modules/professional_profile/professional_profile.service";
import { SubscriptionServices } from "../app/modules/subscription/subscription.service";
import {
  ApplicationStatus,
  JobStatus,
  JobType,
  SalaryFrequency,
  WorkplaceType,
} from "../app/modules/job/job.interface";
import {
  PlanAudience,
  SubscriptionStatus,
} from "../app/modules/subscription/subscription.interface";
import {
  createJobSchema,
} from "../app/modules/job/job.validation";
import { toggleWorkerListingSchema } from "../app/modules/professional_profile/professional_profile.validation";
import { createPlanSchema } from "../app/modules/subscription/subscription.validation";

describe("Jobs, Worker Profiles & CV Module (Step 7)", () => {
  describe("Candidate Match Score Algorithm", () => {
    it("returns 100% when job has no specific preferred skills or languages", () => {
      const score = JobServices.calculateMatchScore(
        ["Electrical Wiring", "Solar Panels"],
        [],
        ["French"],
        [],
      );
      expect(score).toBe(100);
    });

    it("calculates accurate match percentage based on matched skills", () => {
      const applicantSkills = ["React", "TypeScript", "Node.js", "Docker"];
      const jobPrefSkills = ["TypeScript", "Node.js", "MongoDB", "Kubernetes"];

      // 2 out of 4 skills matched = 50%
      const score = JobServices.calculateMatchScore(
        applicantSkills,
        jobPrefSkills,
      );
      expect(score).toBe(50);
    });

    it("handles case-insensitive and whitespace-padded skill comparisons", () => {
      const applicantSkills = ["  JavaScript  ", "PYTHON", "Postgresql "];
      const jobPrefSkills = ["javascript", "python", "postgresql"];

      const score = JobServices.calculateMatchScore(
        applicantSkills,
        jobPrefSkills,
      );
      expect(score).toBe(100);
    });

    it("applies 80/20 weighting when both skills and languages are specified", () => {
      // 100% skills match (80 pts) + 50% language match (10 pts) = 90%
      const applicantSkills = ["Welding", "Safety"];
      const jobPrefSkills = ["Welding", "Safety"];
      const applicantLangs = ["French"];
      const jobPrefLangs = ["French", "English"];

      const score = JobServices.calculateMatchScore(
        applicantSkills,
        jobPrefSkills,
        applicantLangs,
        jobPrefLangs,
      );
      expect(score).toBe(90);
    });
  });

  describe("Validation Schemas & Domain Rules", () => {
    it("validates create job schema correctly", () => {
      const valid = createJobSchema.safeParse({
        organizationName: "Conakry Tech Hub",
        title: "Senior Full Stack Engineer",
        jobType: JobType.full_time,
        workplace: WorkplaceType.hybrid,
        city: "Conakry",
        salaryCurrency: "GNF",
        salaryMin: 15000000,
        salaryMax: 25000000,
        salaryFrequency: SalaryFrequency.monthly,
        about: "We are looking for an experienced software engineer to lead our product team.",
        prefSkills: ["TypeScript", "Node.js"],
        vacancies: 2,
      });
      expect(valid.success).toBe(true);

      const invalid = createJobSchema.safeParse({
        title: "Dev",
        // missing organizationName and about
      });
      expect(invalid.success).toBe(false);
    });

    it("validates worker listing toggle schema", () => {
      const valid = toggleWorkerListingSchema.safeParse({
        isWorkerListed: true,
        hourlyRate: 50000,
        experienceYears: 5,
      });
      expect(valid.success).toBe(true);
    });

    it("validates subscription plan schema", () => {
      const valid = createPlanSchema.safeParse({
        name: "Professional",
        audience: PlanAudience.job_seeker,
        price: 50000,
        durationDays: 30,
        features: ["cv_visibility", "ai_cv", "priority_search"],
      });
      expect(valid.success).toBe(true);
    });

    it("verifies Domain 6 enums conform to database design", () => {
      expect(Object.values(JobType)).toEqual([
        "full_time",
        "part_time",
        "contract",
        "internship",
      ]);
      expect(Object.values(WorkplaceType)).toEqual([
        "on_site",
        "remote",
        "hybrid",
      ]);
      expect(Object.values(JobStatus)).toEqual([
        "draft",
        "pending_payment",
        "published",
        "closed",
        "expired",
      ]);
      expect(Object.values(ApplicationStatus)).toEqual([
        "applied",
        "under_review",
        "shortlisted",
        "interview",
        "hired",
        "rejected",
        "withdrawn",
      ]);
      expect(Object.values(PlanAudience)).toEqual([
        "job_seeker",
        "service_provider",
      ]);
      expect(Object.values(SubscriptionStatus)).toEqual([
        "pending",
        "active",
        "expired",
        "cancelled",
      ]);
    });
  });

  describe("Protected Endpoints (Auth Guard & RBAC)", () => {
    it("GET /api/v1/professional-profiles/me rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/professional-profiles/me");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("PUT /api/v1/professional-profiles/me rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .put("/api/v1/professional-profiles/me")
        .send({ profession: "Electrician" });
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/professional-profiles/me/worker-listing rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/professional-profiles/me/worker-listing")
        .send({ isWorkerListed: true });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/professional-profiles/me/generate-ai-cv rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/professional-profiles/me/generate-ai-cv")
        .send({ tone: "professional" });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/jobs rejects unauthenticated request with 401", async () => {
      const res = await request(app).post("/api/v1/jobs").send({
        organizationName: "Store",
        title: "Cashier",
      });
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/jobs/:id rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/jobs/654321654321654321654321")
        .send({ title: "Updated Title" });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/jobs/:id/publish rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/jobs/654321654321654321654321/publish")
        .send({ paymentMethod: "orange_money" });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/jobs/:id/close rejects unauthenticated request with 401", async () => {
      const res = await request(app).post(
        "/api/v1/jobs/654321654321654321654321/close",
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/jobs/apply rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/jobs/apply")
        .send({ jobId: "654321654321654321654321" });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/jobs/apply-spontaneous rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/jobs/apply-spontaneous")
        .send({
          targetVendorId: "654321654321654321654321",
          paymentMethod: "orange_money",
        });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/jobs/applications/my rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/jobs/applications/my");
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/jobs/:id/applicants rejects unauthenticated request with 401", async () => {
      const res = await request(app).get(
        "/api/v1/jobs/654321654321654321654321/applicants",
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/jobs/candidates/:applicantId/unlock-cv rejects unauthenticated request with 401", async () => {
      const res = await request(app).post(
        "/api/v1/jobs/candidates/654321654321654321654321/unlock-cv",
      );
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/subscriptions/me rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/subscriptions/me");
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/subscriptions/subscribe rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/subscriptions/subscribe")
        .send({
          planId: "654321654321654321654321",
          paymentMethod: "orange_money",
        });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/subscriptions/admin/plans rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/subscriptions/admin/plans")
        .send({
          name: "Plan",
          audience: "job_seeker",
          price: 50000,
        });
      expect(res.status).toBe(401);
    });
  });

  describe("Public Directory Endpoints", () => {
    it("GET /api/v1/professional-profiles/workers is accessible without auth", async () => {
      jest
        .spyOn(ProfessionalProfileServices, "searchWorkers")
        .mockResolvedValue({
          meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
          data: [],
        } as any);

      const res = await request(app).get(
        "/api/v1/professional-profiles/workers",
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("success", true);
    });

    it("GET /api/v1/jobs is accessible without auth", async () => {
      jest.spyOn(JobServices, "searchJobs").mockResolvedValue({
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        data: [],
      } as any);

      const res = await request(app).get("/api/v1/jobs");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("success", true);
    });

    it("GET /api/v1/subscriptions/plans is accessible without auth", async () => {
      jest
        .spyOn(SubscriptionServices, "getActivePlans")
        .mockResolvedValue([] as any);

      const res = await request(app).get("/api/v1/subscriptions/plans");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("success", true);
    });
  });
});

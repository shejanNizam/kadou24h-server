import request from "supertest";
import app from "../app";
import { ReviewStatus } from "../app/modules/review/review.interface";
import { Review } from "../app/modules/review/review.model";
import { ReviewValidations } from "../app/modules/review/review.validation";

describe("Order & Product Reviews Module", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Review Validation Schemas", () => {
    it("validates a correct review submission payload", () => {
      const valid = ReviewValidations.createReviewZodSchema.safeParse({
        body: {
          subOrderId: "64f1a2b3c4d5e6f7a8b9c0d1",
          rating: 5,
          comment: "Produit authentique et livraison très rapide à Kaloum !",
        },
      });
      expect(valid.success).toBe(true);
    });

    it("rejects ratings less than 1 or greater than 5", () => {
      const tooLow = ReviewValidations.createReviewZodSchema.safeParse({
        body: {
          subOrderId: "64f1a2b3c4d5e6f7a8b9c0d1",
          rating: 0,
        },
      });
      expect(tooLow.success).toBe(false);

      const tooHigh = ReviewValidations.createReviewZodSchema.safeParse({
        body: {
          subOrderId: "64f1a2b3c4d5e6f7a8b9c0d1",
          rating: 6,
        },
      });
      expect(tooHigh.success).toBe(false);
    });

    it("rejects non-integer ratings", () => {
      const nonInt = ReviewValidations.createReviewZodSchema.safeParse({
        body: {
          subOrderId: "64f1a2b3c4d5e6f7a8b9c0d1",
          rating: 4.5,
        },
      });
      expect(nonInt.success).toBe(false);
    });

    it("validates admin status toggle", () => {
      const valid = ReviewValidations.updateReviewStatusZodSchema.safeParse({
        body: {
          status: ReviewStatus.hidden,
        },
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Rating Aggregation Algorithm", () => {
    const calculateAverageRating = (ratings: number[]): { ratingAvg: number; ratingCount: number } => {
      if (!ratings || ratings.length === 0) return { ratingAvg: 0, ratingCount: 0 };
      const sum = ratings.reduce((acc, r) => acc + r, 0);
      const avg = Math.round((sum / ratings.length) * 10) / 10;
      return { ratingAvg: avg, ratingCount: ratings.length };
    };

    it("calculates accurate rounded average and total review count", () => {
      expect(calculateAverageRating([5, 5, 4, 4])).toEqual({ ratingAvg: 4.5, ratingCount: 4 });
      expect(calculateAverageRating([5, 4, 3, 2, 1])).toEqual({ ratingAvg: 3.0, ratingCount: 5 });
      expect(calculateAverageRating([5, 5, 5])).toEqual({ ratingAvg: 5.0, ratingCount: 3 });
      expect(calculateAverageRating([])).toEqual({ ratingAvg: 0, ratingCount: 0 });
    });
  });

  describe("API Authentication & Route Guards", () => {
    it("returns 401 Unauthorized for POST /api/v1/reviews without token", async () => {
      const res = await request(app).post("/api/v1/reviews").send({
        subOrderId: "64f1a2b3c4d5e6f7a8b9c0d1",
        rating: 5,
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/reviews/me without token", async () => {
      const res = await request(app).get("/api/v1/reviews/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for POST /api/v1/reviews/:id/report without token", async () => {
      const res = await request(app).post("/api/v1/reviews/64f1a2b3c4d5e6f7a8b9c0d1/report");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for PATCH /api/v1/reviews/admin/:id/status without token", async () => {
      const res = await request(app).patch("/api/v1/reviews/admin/64f1a2b3c4d5e6f7a8b9c0d1/status").send({
        status: ReviewStatus.hidden,
      });
      expect(res.status).toBe(401);
    });

    it("allows public access to GET /api/v1/reviews/vendor/:vendorId", async () => {
      jest.spyOn(Review, "find").mockReturnValue({
        populate: () => ({
          sort: () => ({
            skip: () => ({
              limit: () => ({
                lean: async () => [
                  {
                    _id: "64f1a2b3c4d5e6f7a8b9c0d1",
                    rating: 5,
                    comment: "Excellent service !",
                  },
                ],
              }),
            }),
          }),
        }),
      } as any);

      jest.spyOn(Review, "countDocuments").mockResolvedValue(1 as any);

      const res = await request(app).get("/api/v1/reviews/vendor/64f1a2b3c4d5e6f7a8b9c0d1");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
    });

    it("allows public access to GET /api/v1/reviews/product/:productId", async () => {
      jest.spyOn(Review, "find").mockReturnValue({
        populate: () => ({
          sort: () => ({
            skip: () => ({
              limit: () => ({
                lean: async () => [],
              }),
            }),
          }),
        }),
      } as any);

      jest.spyOn(Review, "countDocuments").mockResolvedValue(0 as any);

      const res = await request(app).get("/api/v1/reviews/product/64f1a2b3c4d5e6f7a8b9c0d1");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});

import request from "supertest";
import app from "../app";

describe("Catalog & Favorites Endpoints", () => {
  describe("Route registration & 404 checks", () => {
    it("routes are mounted and don't return 404 for registered routes", async () => {
      // Calling with invalid auth returns 401, not 404 (confirming route exists and middleware runs)
      const res = await request(app).get("/api/v1/products/admin");
      expect(res.status).toBe(401);
    });
  });

  describe("Protected catalog routes require authentication", () => {
    it("GET /api/v1/products/admin rejects unauthenticated requests with 401", async () => {
      const res = await request(app).get("/api/v1/products/admin");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("GET /api/v1/products/my-products rejects unauthenticated requests with 401", async () => {
      const res = await request(app).get("/api/v1/products/my-products");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("POST /api/v1/products rejects unauthenticated requests with 401", async () => {
      const res = await request(app).post("/api/v1/products").send({
        name: "Test Product",
        price: 50000,
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("PATCH /api/v1/products/:id rejects unauthenticated requests with 401", async () => {
      const res = await request(app).patch("/api/v1/products/654321654321654321654321").send({
        name: "Updated Product",
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("PATCH /api/v1/products/:id/approval rejects unauthenticated requests with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/products/654321654321654321654321/approval")
        .send({
          approvalStatus: "approved",
        });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("DELETE /api/v1/products/:id rejects unauthenticated requests with 401", async () => {
      const res = await request(app).delete("/api/v1/products/654321654321654321654321");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });
  });

  describe("Protected favorite routes require authentication", () => {
    it("GET /api/v1/favorites/my-favorites rejects unauthenticated requests with 401", async () => {
      const res = await request(app).get("/api/v1/favorites/my-favorites");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("GET /api/v1/favorites/check/:productId rejects unauthenticated requests with 401", async () => {
      const res = await request(app).get("/api/v1/favorites/check/654321654321654321654321");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("POST /api/v1/favorites/toggle rejects unauthenticated requests with 401", async () => {
      const res = await request(app).post("/api/v1/favorites/toggle").send({
        productId: "654321654321654321654321",
      });
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });
  });
});

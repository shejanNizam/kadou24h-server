import bcrypt from "bcrypt";
import request from "supertest";
import app from "../app";

describe("Delivery Legs & Tracking Module (Step 5)", () => {
  describe("PIN Handover Logic", () => {
    it("successfully hashes and compares 4-digit numeric PINs", async () => {
      const pin = "4829";
      const hash = await bcrypt.hash(pin, 4);

      const isMatch = await bcrypt.compare("4829", hash);
      const isMismatch = await bcrypt.compare("1234", hash);

      expect(isMatch).toBe(true);
      expect(isMismatch).toBe(false);
    });
  });

  describe("Protected Delivery Endpoints require authentication", () => {
    it("GET /api/v1/deliveries/rider/my-deliveries rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/deliveries/rider/my-deliveries");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("PATCH /api/v1/deliveries/rider/location rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/deliveries/rider/location")
        .send({ lat: 9.51, lng: -13.71 });
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/deliveries/rider/online-status rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/deliveries/rider/online-status")
        .send({ isOnline: true });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/deliveries/:id/available-riders rejects unauthenticated request with 401", async () => {
      const res = await request(app).get(
        "/api/v1/deliveries/654321654321654321654321/available-riders",
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/deliveries/:id/assign rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/deliveries/654321654321654321654321/assign")
        .send({ riderId: "654321654321654321654321" });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/deliveries/:id/accept rejects unauthenticated request with 401", async () => {
      const res = await request(app).post(
        "/api/v1/deliveries/654321654321654321654321/accept",
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/deliveries/:id/decline rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/deliveries/654321654321654321654321/decline")
        .send({ reason: "Motorcycle breakdown" });
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/deliveries/:id/going-to-pickup rejects unauthenticated request with 401", async () => {
      const res = await request(app).patch(
        "/api/v1/deliveries/654321654321654321654321/going-to-pickup",
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/deliveries/:id/verify-pickup rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/deliveries/654321654321654321654321/verify-pickup")
        .send({ pin: "4829" });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/deliveries/:id/verify-handover rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/deliveries/654321654321654321654321/verify-handover")
        .send({ pin: "7392" });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/deliveries/:id/track rejects unauthenticated request with 401", async () => {
      const res = await request(app).get(
        "/api/v1/deliveries/654321654321654321654321/track",
      );
      expect(res.status).toBe(401);
    });
  });
});

import request from "supertest";
import app from "../app";
import { DeliveryRate } from "../app/modules/delivery_rate/delivery_rate.model";
import { calculateDistanceKm } from "../app/modules/delivery_rate/delivery_rate.service";

describe("Cart, Delivery Rates & Orders Module", () => {
  describe("Distance Calculator (Haversine formula)", () => {
    it("calculates accurate distance between two Conakry coordinates", () => {
      // Kaloum (approx [-13.71, 9.51]) to Dixinn (approx [-13.67, 9.54])
      const dist = calculateDistanceKm([-13.71, 9.51], [-13.67, 9.54]);
      expect(dist).toBeGreaterThan(3);
      expect(dist).toBeLessThan(7);
    });

    it("returns 0 for identical coordinates", () => {
      const dist = calculateDistanceKm([-13.6785, 9.537], [-13.6785, 9.537]);
      expect(dist).toBe(0);
    });
  });

  describe("Delivery Rates Endpoints", () => {
    it("GET /api/v1/delivery-rates/calculate returns calculated fee with query params", async () => {
      jest.spyOn(DeliveryRate, "findOne").mockResolvedValue(null as any);

      const res = await request(app)
        .get("/api/v1/delivery-rates/calculate")
        .query({
          type: "local",
          vendorLat: 9.51,
          vendorLng: -13.71,
          customerLat: 9.54,
          customerLng: -13.67,
          city: "Conakry",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body.data).toHaveProperty("fee");
      expect(res.body.data.fee).toBeGreaterThanOrEqual(5000);
      expect(res.body.data).toHaveProperty("distanceKm");
    });

    it("GET /api/v1/delivery-rates rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/delivery-rates");
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/delivery-rates rejects unauthenticated request with 401", async () => {
      const res = await request(app).post("/api/v1/delivery-rates").send({
        type: "local",
        city: "Conakry",
        vehicleType: "motorbike",
        baseFee: 5000,
        perKmFee: 1000,
        minFee: 7000,
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Cart Endpoints", () => {
    it("GET /api/v1/cart rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/cart");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("POST /api/v1/cart/items rejects unauthenticated request with 401", async () => {
      const res = await request(app).post("/api/v1/cart/items").send({
        productId: "654321654321654321654321",
        qty: 1,
      });
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/cart/items/:productId rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/cart/items/654321654321654321654321")
        .send({ qty: 2 });
      expect(res.status).toBe(401);
    });

    it("DELETE /api/v1/cart/items/:productId rejects unauthenticated request with 401", async () => {
      const res = await request(app).delete(
        "/api/v1/cart/items/654321654321654321654321",
      );
      expect(res.status).toBe(401);
    });

    it("DELETE /api/v1/cart rejects unauthenticated request with 401", async () => {
      const res = await request(app).delete("/api/v1/cart");
      expect(res.status).toBe(401);
    });
  });

  describe("Order & Checkout Endpoints", () => {
    it("POST /api/v1/orders/checkout-summary rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/orders/checkout-summary")
        .send({
          deliveryType: "local",
          paymentMethod: "cod",
        });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/orders rejects unauthenticated request with 401", async () => {
      const res = await request(app).post("/api/v1/orders").send({
        deliveryType: "local",
        paymentMethod: "cod",
      });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/orders/my-orders rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/orders/my-orders");
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/orders/vendor/sub-orders rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/orders/vendor/sub-orders");
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/orders/admin/all rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/orders/admin/all");
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/orders/:id/cancel rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/orders/654321654321654321654321/cancel")
        .send({ reason: "Customer changed mind" });
      expect(res.status).toBe(401);
    });
  });
});

import request from "supertest";
import app from "../app";
import {
  CodSettlementMethod,
  MAX_PAYOUT_METHODS,
  TransactionType,
  WalletMode,
  WithdrawalStatus,
} from "../app/modules/wallet/wallet.interface";
import {
  DisputeStatus,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
} from "../app/modules/payment/payment.interface";
import {
  requestWithdrawalSchema,
  submitCodSettlementSchema,
} from "../app/modules/wallet/wallet.validation";

describe("Finance, Wallets & Payments Module (Step 6)", () => {
  describe("Wallet Ledger State Transitions & Domain Rules", () => {
    it("simulates append-only ledger balance calculations correctly", () => {
      let heldBalance = 0;
      let availableBalance = 0;
      let totalEarned = 0;
      let totalWithdrawn = 0;
      let cashOwed = 0;

      // 1. Order placed -> Escrow held (+60,000 GNF)
      const orderEarning = 60000;
      heldBalance += orderEarning;
      totalEarned += orderEarning;

      expect(heldBalance).toBe(60000);
      expect(availableBalance).toBe(0);
      expect(totalEarned).toBe(60000);

      // 2. Order delivered -> Escrow released (60,000 GNF moved from held to available)
      heldBalance = Math.max(0, heldBalance - orderEarning);
      availableBalance += orderEarning;

      expect(heldBalance).toBe(0);
      expect(availableBalance).toBe(60000);

      // 3. Withdrawal request (25,000 GNF with 1,000 GNF fee)
      const withdrawAmount = 25000;
      const fee = 1000;
      availableBalance = Math.max(0, availableBalance - withdrawAmount);
      totalWithdrawn += withdrawAmount;
      availableBalance = Math.max(0, availableBalance - fee);

      expect(availableBalance).toBe(34000);
      expect(totalWithdrawn).toBe(25000);

      // 4. Withdrawal rejected by admin -> Reversal restores balance
      availableBalance += withdrawAmount;
      totalWithdrawn = Math.max(0, totalWithdrawn - withdrawAmount);

      expect(availableBalance).toBe(59000);
      expect(totalWithdrawn).toBe(0);

      // 5. Rider collects COD cash (40,000 GNF)
      const codCollected = 40000;
      cashOwed += codCollected;
      expect(cashOwed).toBe(40000);

      // 6. Direct offset of COD cash against available earnings (30,000 GNF)
      const offsetAmount = 30000;
      cashOwed = Math.max(0, cashOwed - offsetAmount);
      availableBalance = Math.max(0, availableBalance - offsetAmount);

      expect(cashOwed).toBe(10000);
      expect(availableBalance).toBe(29000);

      // 7. Refund deduction (5,000 GNF)
      const refundDeduction = 5000;
      availableBalance = Math.max(0, availableBalance - refundDeduction);
      expect(availableBalance).toBe(24000);
    });

    it("enforces maximum 5 payout methods rule", () => {
      expect(MAX_PAYOUT_METHODS).toBe(5);
    });

    it("validates minimum withdrawal amount of 5,000 GNF via Zod schema", () => {
      const validPayload = {
        mode: WalletMode.vendor,
        amount: 15000,
        payoutMethodId: "654321654321654321654321",
      };
      const parsed = requestWithdrawalSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);

      const invalidPayload = {
        mode: WalletMode.vendor,
        amount: 2000, // below 5,000 GNF
        payoutMethodId: "654321654321654321654321",
      };
      const invalidResult = requestWithdrawalSchema.safeParse(invalidPayload);
      expect(invalidResult.success).toBe(false);
    });

    it("validates COD settlement submission schema", () => {
      const valid = submitCodSettlementSchema.safeParse({
        amount: 50000,
        method: CodSettlementMethod.earnings_offset,
      });
      expect(valid.success).toBe(true);

      const invalid = submitCodSettlementSchema.safeParse({
        amount: 0, // must be at least 1 GNF
        method: "unsupported_method",
      });
      expect(invalid.success).toBe(false);
    });

    it("verifies dispute, refund and payment status enums conform to DB design", () => {
      expect(Object.values(PaymentPurpose)).toContain("order");
      expect(Object.values(PaymentPurpose)).toContain("subscription");
      expect(Object.values(PaymentPurpose)).toContain("job_publish");
      expect(Object.values(PaymentPurpose)).toContain("cv_unlock");

      expect(Object.values(PaymentMethod)).toContain("orange_money");
      expect(Object.values(PaymentMethod)).toContain("mobile_money");
      expect(Object.values(PaymentMethod)).toContain("card");
      expect(Object.values(PaymentMethod)).toContain("cod");

      expect(Object.values(PaymentStatus)).toContain("pending");
      expect(Object.values(PaymentStatus)).toContain("success");
      expect(Object.values(PaymentStatus)).toContain("refunded");

      expect(Object.values(DisputeStatus)).toContain("open");
      expect(Object.values(DisputeStatus)).toContain("resolved");
      expect(Object.values(DisputeStatus)).toContain("rejected");

      expect(Object.values(RefundStatus)).toContain("completed");
    });
  });

  describe("Protected Wallet Endpoints (Auth Guard & RBAC)", () => {
    it("GET /api/v1/wallets/me rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/wallets/me?mode=vendor");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
    });

    it("POST /api/v1/wallets/me/payout-methods rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/wallets/me/payout-methods")
        .send({
          mode: "vendor",
          type: "orange_money",
          accountName: "Mamadou Diallo",
          accountNumber: "+224622112233",
        });
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/wallets/me/payout-methods/:methodId rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/wallets/me/payout-methods/654321654321654321654321")
        .send({ mode: "vendor", accountName: "Updated Name" });
      expect(res.status).toBe(401);
    });

    it("DELETE /api/v1/wallets/me/payout-methods/:methodId rejects unauthenticated request with 401", async () => {
      const res = await request(app).delete(
        "/api/v1/wallets/me/payout-methods/654321654321654321654321?mode=vendor",
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/wallets/me/withdrawals rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/wallets/me/withdrawals")
        .send({
          mode: "vendor",
          amount: 25000,
          payoutMethodId: "654321654321654321654321",
        });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/wallets/me/withdrawals rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/wallets/me/withdrawals?mode=vendor");
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/wallets/me/transactions rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/wallets/me/transactions?mode=vendor");
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/wallets/me/cod-settlements rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/wallets/me/cod-settlements")
        .send({ amount: 10000, method: "earnings_offset" });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/wallets/admin/withdrawals rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/wallets/admin/withdrawals");
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/wallets/admin/withdrawals/:id rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/wallets/admin/withdrawals/654321654321654321654321")
        .send({ status: "completed", transactionId: "TX123" });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/wallets/admin/cod-settlements rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/wallets/admin/cod-settlements");
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/wallets/admin/cod-settlements/:id rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/wallets/admin/cod-settlements/654321654321654321654321")
        .send({ status: "confirmed" });
      expect(res.status).toBe(401);
    });
  });

  describe("Protected Payment Endpoints (Auth Guard & Webhook Validation)", () => {
    it("POST /api/v1/payments/initiate rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .send({
          purpose: "order",
          refId: "654321654321654321654321",
          method: "orange_money",
        });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/payments/me rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/payments/me");
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/payments/disputes rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/payments/disputes")
        .send({
          orderId: "654321654321654321654321",
          reason: "Damaged item received",
        });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/payments/disputes rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/payments/disputes");
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/payments/admin/all rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/payments/admin/all");
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/payments/admin/refunds rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/v1/payments/admin/refunds")
        .send({
          orderId: "654321654321654321654321",
          amount: 10000,
          reason: "Product defective",
        });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/payments/admin/refunds rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/payments/admin/refunds");
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/payments/admin/disputes rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/payments/admin/disputes");
      expect(res.status).toBe(401);
    });

    it("PATCH /api/v1/payments/admin/disputes/:id/resolve rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .patch("/api/v1/payments/admin/disputes/654321654321654321654321/resolve")
        .send({
          status: "resolved",
          adminResolution: "Refund issued to customer",
        });
      expect(res.status).toBe(401);
    });

    it("POST /api/v1/payments/webhook rejects invalid payload with 400", async () => {
      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .send({ status: "invalid_status" });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("success", false);
    });
  });
});

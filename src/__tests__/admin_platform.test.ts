import request from "supertest";
import app from "../app";
import { Advertisement } from "../app/modules/advertisement/advertisement.model";
import {
  AdPlacement,
  AdStatus,
  AdType,
} from "../app/modules/advertisement/advertisement.interface";
import { AdvertisementValidations } from "../app/modules/advertisement/advertisement.validation";
import { Counter } from "../app/modules/counter/counter.model";
import { CounterServices } from "../app/modules/counter/counter.service";
import {
  TicketStatus,
  TicketType,
  TicketUrgency,
} from "../app/modules/support_ticket/support_ticket.interface";
import { SupportTicketValidations } from "../app/modules/support_ticket/support_ticket.validation";
import { AppMode } from "../app/modules/user/user.interface";

describe("Admin Panel, Platform Settings, Support Tickets & Ads (Step 9)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Support Ticket Numbering & Validation", () => {
    it("generates sequential SUP- prefixed ticket numbers", async () => {
      let seqCounter = 200;
      jest.spyOn(Counter, "findOneAndUpdate").mockImplementation((async () => {
        seqCounter += 1;
        return { seq: seqCounter };
      }) as any);

      const code1 = await CounterServices.nextCode("ticket");
      const code2 = await CounterServices.nextCode("ticket");

      expect(code1).toBe("SUP-201");
      expect(code2).toBe("SUP-202");
      expect(code1).toMatch(/^SUP-\d+$/);
    });

    it("validates valid createTicket payload", () => {
      const valid = SupportTicketValidations.createTicketZodSchema.safeParse({
        body: {
          type: TicketType.order_issue,
          userMode: AppMode.customer,
          subject: "Colis non reçu",
          urgency: TicketUrgency.high,
          description: "Le livreur a indiqué le colis livré mais je n'ai rien reçu.",
          attachments: ["https://res.cloudinary.com/kadou24h/image/upload/receipt.jpg"],
        },
      });
      expect(valid.success).toBe(true);
    });

    it("rejects ticket with description shorter than 5 characters", () => {
      const invalid = SupportTicketValidations.createTicketZodSchema.safeParse({
        body: {
          type: TicketType.general,
          description: "Aide",
        },
      });
      expect(invalid.success).toBe(false);
    });

    it("validates status and resolution updates", () => {
      const valid = SupportTicketValidations.updateTicketStatusZodSchema.safeParse({
        body: {
          status: TicketStatus.resolved,
          resolution: "Remboursement effectué sur le wallet client.",
        },
      });
      expect(valid.success).toBe(true);
    });

    it("validates ticket assignment payload", () => {
      const valid = SupportTicketValidations.assignTicketZodSchema.safeParse({
        body: {
          assignedTo: "64f1a2b3c4d5e6f7a8b9c0d1",
        },
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Advertisement Campaigns & Click-Through Analytics", () => {
    it("validates valid advertisement creation payload", () => {
      const valid = AdvertisementValidations.createAdZodSchema.safeParse({
        body: {
          name: "Promo Rentrée Conakry",
          advertiserName: "Orange Guinée",
          type: AdType.banner,
          placement: AdPlacement.home,
          images: ["https://res.cloudinary.com/kadou24h/image/upload/banner.png"],
          linkUrl: "https://orangeguinee.com/promo",
          description: "Bannière publicitaire pour l'offre spéciale rentrée.",
          startAt: "2026-10-01T00:00:00.000Z",
          endAt: "2026-10-31T23:59:59.000Z",
          status: AdStatus.active,
        },
      });
      expect(valid.success).toBe(true);
    });

    it("rejects advertisement missing required image", () => {
      const invalid = AdvertisementValidations.createAdZodSchema.safeParse({
        body: {
          name: "Bannière sans image",
          advertiserName: "Test Advertiser",
          placement: AdPlacement.home,
          images: [],
          startAt: "2026-10-01T00:00:00.000Z",
          endAt: "2026-10-31T23:59:59.000Z",
        },
      });
      expect(invalid.success).toBe(false);
    });

    it("calculates accurate CTR (Click-Through Rate) percentage", () => {
      const calculateCtr = (impressions: number, clicks: number): number => {
        if (!impressions || impressions === 0) return 0;
        return Number(((clicks / impressions) * 100).toFixed(2));
      };

      expect(calculateCtr(1000, 50)).toBe(5.0);
      expect(calculateCtr(2500, 75)).toBe(3.0);
      expect(calculateCtr(0, 0)).toBe(0);
      expect(calculateCtr(10000, 125)).toBe(1.25);
    });
  });

  describe("API Authentication & Route Guards", () => {
    it("returns 401 Unauthorized for POST /api/v1/support-tickets without token", async () => {
      const res = await request(app).post("/api/v1/support-tickets").send({
        type: TicketType.general,
        description: "Besoin d'aide pour mon compte",
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/support-tickets/me without token", async () => {
      const res = await request(app).get("/api/v1/support-tickets/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/support-tickets/admin/all without token", async () => {
      const res = await request(app).get("/api/v1/support-tickets/admin/all");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for POST /api/v1/advertisements/admin without token", async () => {
      const res = await request(app).post("/api/v1/advertisements/admin").send({
        name: "Test Ad",
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/advertisements/admin/all without token", async () => {
      const res = await request(app).get("/api/v1/advertisements/admin/all");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/admin/dashboard/overview without token", async () => {
      const res = await request(app).get("/api/v1/admin/dashboard/overview");
      expect(res.status).toBe(401);
    });

    it("allows public access to GET /api/v1/advertisements", async () => {
      jest.spyOn(Advertisement, "find").mockReturnValue({
        sort: () => ({
          lean: async () => [
            {
              _id: "64f1a2b3c4d5e6f7a8b9c0d1",
              name: "Public Banner",
              advertiserName: "Test Brand",
              placement: "home",
              images: ["https://example.com/banner.png"],
              status: "active",
            },
          ],
        }),
      } as any);

      const res = await request(app).get("/api/v1/advertisements");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
    });
  });
});

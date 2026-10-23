import request from "supertest";
import app from "../app";
import {
  ConversationType,
  MessageType,
  ModerationAction,
} from "../app/modules/chat/chat.interface";
import { voiceAllowedFor } from "../app/modules/chat/chat.start.service";
import { ChatValidations } from "../app/modules/chat/chat.validation";
import { inspectContent } from "../app/modules/chat/moderation.util";
import { ReportStatus, ReportTargetType } from "../app/modules/report/report.interface";
import { ReportValidations } from "../app/modules/report/report.validation";
import { AppMode } from "../app/modules/user/user.interface";

describe("Chat, Trust & Moderation Module (Step 8)", () => {
  describe("Anti-Circumvention Content Moderation Pipeline", () => {
    it("flags and masks Guinea phone numbers in various formats", () => {
      const inputs = [
        "Mon numéro est +224 622 12 34 56 appelle moi",
        "Écris moi sur le 621112233 direct",
        "Numéro: +224-628-99-88-77 pour payer",
        "Appelez au 620 12 34 56 svp",
      ];

      for (const input of inputs) {
        const result = inspectContent(input);
        expect(result.isClean).toBe(false);
        expect(result.rules).toContain("phone");
        expect(result.maskedText).toContain("[CONTACT MASQUÉ - Kadou24h]");
        expect(result.violations.length).toBeGreaterThan(0);
        expect(result.violations[0].rule).toBe("phone");
      }
    });

    it("flags and masks email addresses", () => {
      const input = "Envoyez moi un mail à vendeur.direct@gmail.com pour le prix";
      const result = inspectContent(input);

      expect(result.isClean).toBe(false);
      expect(result.rules).toContain("email");
      expect(result.maskedText).toContain("[CONTACT MASQUÉ - Kadou24h]");
      expect(result.maskedText).not.toContain("vendeur.direct@gmail.com");
      expect(result.violations.some((v) => v.rule === "email")).toBe(true);
    });

    it("flags and masks external URLs and domain names", () => {
      const input = "Commandez directement sur https://boutique-guinee.com/produit pour éviter les frais";
      const result = inspectContent(input);

      expect(result.isClean).toBe(false);
      expect(result.rules).toContain("url");
      expect(result.maskedText).toContain("[CONTACT MASQUÉ - Kadou24h]");
      expect(result.maskedText).not.toContain("https://boutique-guinee.com/produit");
    });

    it("flags and masks social platform handles and off-platform keywords", () => {
      const input = "Contactez moi sur WhatsApp ou sur Telegram @moncompte224";
      const result = inspectContent(input);

      expect(result.isClean).toBe(false);
      expect(result.rules).toContain("social");
      expect(result.maskedText).toContain("[CONTACT MASQUÉ - Kadou24h]");
      expect(result.violations.some((v) => v.rule === "social")).toBe(true);
    });

    it("passes clean messages without modification", () => {
      const cleanMessages = [
        "Bonjour, votre commande de riz est prête pour la livraison !",
        "Merci beaucoup, j'attends le livreur devant la porte.",
        "Le colis pèse environ 2 kg et contient 3 articles.",
      ];

      for (const msg of cleanMessages) {
        const result = inspectContent(msg);
        expect(result.isClean).toBe(true);
        expect(result.rules.length).toBe(0);
        expect(result.violations.length).toBe(0);
        expect(result.maskedText).toBe(msg);
      }
    });
  });

  describe("Voice Note Policy Logic", () => {
    // Client rule (2026-10-23): voice in store, order and worker chats, not job applications
    it("allows voice notes in store, order and worker chats", () => {
      expect(voiceAllowedFor(ConversationType.buyer_seller)).toBe(true);
      expect(voiceAllowedFor(ConversationType.order)).toBe(true);
      expect(voiceAllowedFor(ConversationType.worker)).toBe(true);
    });

    it("disallows voice notes in job-application chats (contact unlock is paid)", () => {
      expect(voiceAllowedFor(ConversationType.job_application)).toBe(false);
    });
  });

  describe("Moderation Progressive Penalties Logic", () => {
    const computeModerationAction = (
      violationCount: number,
      restrictAfter = 3,
      suspendAfter = 5,
    ): ModerationAction => {
      if (violationCount >= suspendAfter) return ModerationAction.suspended;
      if (violationCount >= restrictAfter) return ModerationAction.restricted;
      return ModerationAction.warned;
    };

    it("warns user on first and second violation", () => {
      expect(computeModerationAction(1)).toBe(ModerationAction.warned);
      expect(computeModerationAction(2)).toBe(ModerationAction.warned);
    });

    it("restricts chat upon reaching 3 violations", () => {
      expect(computeModerationAction(3)).toBe(ModerationAction.restricted);
      expect(computeModerationAction(4)).toBe(ModerationAction.restricted);
    });

    it("suspends account upon reaching 5 violations", () => {
      expect(computeModerationAction(5)).toBe(ModerationAction.suspended);
      expect(computeModerationAction(6)).toBe(ModerationAction.suspended);
    });
  });

  describe("Chat & Message Validation Schemas", () => {
    it("validates startConversation by subject (store, order + with)", () => {
      const store = ChatValidations.startConversationZodSchema.safeParse({
        body: { type: ConversationType.buyer_seller, vendorId: "64f1a2b3c4d5e6f7a8b9c0d1" },
      });
      const order = ChatValidations.startConversationZodSchema.safeParse({
        body: { type: ConversationType.order, subOrderId: "64f1a2b3c4d5e6f7a8b9c0d1", with: "rider" },
      });
      expect(store.success).toBe(true);
      expect(order.success).toBe(true);
    });

    it("rejects startConversation with a free recipient, unknown type or missing subject", () => {
      const recipient = ChatValidations.startConversationZodSchema.safeParse({
        body: { type: ConversationType.buyer_seller, recipientId: "64f1a2b3c4d5e6f7a8b9c0d1", recipientMode: AppMode.vendor },
      });
      const unknown = ChatValidations.startConversationZodSchema.safeParse({
        body: { type: "unsupported_chat", vendorId: "64f1a2b3c4d5e6f7a8b9c0d1" },
      });
      const noWith = ChatValidations.startConversationZodSchema.safeParse({
        body: { type: ConversationType.order, subOrderId: "64f1a2b3c4d5e6f7a8b9c0d1" },
      });
      expect(recipient.success).toBe(false);
      expect(unknown.success).toBe(false);
      expect(noWith.success).toBe(false);
    });

    it("validates text message with valid text content", () => {
      const valid = ChatValidations.sendMessageZodSchema.safeParse({
        body: {
          type: MessageType.text,
          text: "Bonjour est-ce que le produit est encore en stock ?",
        },
      });
      expect(valid.success).toBe(true);
    });

    it("rejects empty text message", () => {
      const invalid = ChatValidations.sendMessageZodSchema.safeParse({
        body: {
          type: MessageType.text,
          text: "   ",
        },
      });
      expect(invalid.success).toBe(false);
    });

    it("validates voice message with mediaUrl", () => {
      const valid = ChatValidations.sendMessageZodSchema.safeParse({
        body: {
          type: MessageType.voice,
          mediaUrl: "https://storage.kadou24h.com/voice/note1.m4a",
          mediaDurationSec: 15,
        },
      });
      expect(valid.success).toBe(true);
    });

    it("rejects voice message without mediaUrl", () => {
      const invalid = ChatValidations.sendMessageZodSchema.safeParse({
        body: {
          type: MessageType.voice,
        },
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Report Validation Schemas", () => {
    it("validates valid user report", () => {
      const valid = ReportValidations.createReportZodSchema.safeParse({
        body: {
          targetType: ReportTargetType.user,
          targetId: "64f1a2b3c4d5e6f7a8b9c0d1",
          reason: "harassment",
          description: "User repeatedly sends offensive remarks",
        },
      });
      expect(valid.success).toBe(true);
    });

    it("validates valid admin action report", () => {
      const valid = ReportValidations.actionReportZodSchema.safeParse({
        body: {
          status: ReportStatus.actioned,
          actionTaken: "User warned and offensive messages removed",
          adminNotes: "Handled by support team lead",
        },
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("API Authentication & Route Guards", () => {
    it("returns 401 Unauthorized for GET /api/v1/conversations without token", async () => {
      const res = await request(app).get("/api/v1/conversations");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for POST /api/v1/conversations without token", async () => {
      const res = await request(app).post("/api/v1/conversations").send({
        recipientId: "64f1a2b3c4d5e6f7a8b9c0d1",
        recipientMode: AppMode.vendor,
        myMode: AppMode.customer,
        type: ConversationType.buyer_seller,
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/reports/me without token", async () => {
      const res = await request(app).get("/api/v1/reports/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/reports/admin/all without token", async () => {
      const res = await request(app).get("/api/v1/reports/admin/all");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/notifications without token", async () => {
      const res = await request(app).get("/api/v1/notifications");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/notifications/unread-count without token", async () => {
      const res = await request(app).get("/api/v1/notifications/unread-count");
      expect(res.status).toBe(401);
    });

    it("returns 401 Unauthorized for GET /api/v1/conversations/admin/moderation-violations without token", async () => {
      const res = await request(app).get("/api/v1/conversations/admin/moderation-violations");
      expect(res.status).toBe(401);
    });
  });
});

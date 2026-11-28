import { buildSystemPrompt, gnf, parseAnswer, type AssistantSettings } from "../app/modules/ai_assistant/ai_assistant.prompt";
import { AssistantValidations } from "../app/modules/ai_assistant/ai_assistant.validation";
import { PayoutMethodType } from "../app/modules/settings/settings.interface";
import { AppMode } from "../app/modules/user/user.interface";

const settings: AssistantSettings = {
  platformName: "Kadou24h",
  platformFee: 1000,
  commission: { rate: 10, min: 1000 },
  escrowReleaseHours: 24,
  riderCashLimitDefault: 1000000,
  withdrawalFees: [{ method: PayoutMethodType.orange_money, type: "percent", value: 1.5 }],
  pricing: { jobPublishFee: 5000, cvUnlockFee: 5000, spontaneousApplicationFee: 2000 },
  orders: { acceptMinutes: 480 },
  intercity: { firstMileFee: 10000, lastMileFee: 10000, maxAddressKm: 30 },
  rides: {
    enabled: true,
    baseFare: 3000,
    perKm: 1500,
    minFare: 5000,
    maxRaisePercent: 30,
    searchRadiusKm: 5,
    subscriptionRequired: false,
    trialDays: 30,
  },
  chat: { retentionDays: 90 },
  whatsappSupportNumber: "+224 610 53 71 67",
  assistant: { knowledge: "Livraison gratuite le vendredi." },
};

describe("Help assistant", () => {
  describe("prompt", () => {
    it("writes money the way the app does", () => {
      expect(gnf(1000000)).toBe("1 000 000 GNF");
      expect(gnf(500)).toBe("500 GNF");
      expect(gnf(undefined)).toBe("0 GNF");
    });

    it("takes the fees from the live settings, not from the code", () => {
      const prompt = buildSystemPrompt(settings, { mode: AppMode.customer, locale: "fr" });
      expect(prompt).toContain("service fee of 1 000 GNF");
      expect(prompt).toContain("within 480 minutes");
      expect(prompt).toContain("within 30 km of the arrival station");
      expect(prompt).toContain("commission of 10% per sale (minimum 1 000 GNF)");
      expect(prompt).toContain("orange_money: 1.5%");
      expect(prompt).toContain("WhatsApp +224 610 53 71 67");
      expect(prompt).toContain("Livraison gratuite le vendredi.");
    });

    it("tells the model the safety rules", () => {
      const prompt = buildSystemPrompt(settings, { mode: AppMode.customer, locale: "fr" });
      expect(prompt).toMatch(/Never give the phone number or email of a store, a rider or a customer/);
      expect(prompt).toMatch(/Never ask for or repeat a password, a code/);
      expect(prompt).toMatch(/Set needsHuman to true/);
    });

    it("lists the person's own orders, with each store's state", () => {
      const prompt = buildSystemPrompt(settings, {
        mode: AppMode.customer,
        locale: "en",
        orders: [
          {
            orderNumber: "KD-0042",
            placedAt: new Date("2026-11-27T10:00:00Z"),
            status: "active",
            paymentMethod: "cod",
            paymentStatus: "unpaid",
            total: 125000,
            stores: [{ storeName: "TechHub", status: "in_delivery" }],
          },
        ],
      });
      expect(prompt).toContain("KD-0042 (2026-11-27), active, cod, payment unpaid, total 125 000 GNF [TechHub: in_delivery]");
    });

    it("leaves out the team's notes when there are none", () => {
      const prompt = buildSystemPrompt({ ...settings, assistant: { knowledge: "  " } }, { mode: AppMode.rider, locale: "fr", rider: { approvalStatus: "approved", isOnline: true } });
      expect(prompt).not.toContain("More information from the Kadou24h team");
      expect(prompt).toContain("Their rider profile: moto, application approved, online.");
    });
  });

  describe("answer", () => {
    it("reads the structured answer", () => {
      expect(parseAnswer('{"reply":"Bonjour","needsHuman":true}')).toEqual({ reply: "Bonjour", needsHuman: true });
    });

    it("keeps plain text when the model did not answer in JSON", () => {
      expect(parseAnswer("Bonjour")).toEqual({ reply: "Bonjour", needsHuman: false });
      expect(parseAnswer('{"other":1}')).toEqual({ reply: '{"other":1}', needsHuman: false });
      expect(parseAnswer(null)).toEqual({ reply: "", needsHuman: false });
    });
  });

  describe("validation", () => {
    it("accepts a normal question and trims it", async () => {
      const parsed = await AssistantValidations.sendMessageZodSchema.parseAsync({ body: { text: "  Où est ma commande ?  " } });
      expect(parsed.body.text).toBe("Où est ma commande ?");
    });

    it("refuses empty, too long or a wrong mode", async () => {
      await expect(AssistantValidations.sendMessageZodSchema.parseAsync({ body: { text: " " } })).rejects.toThrow();
      await expect(AssistantValidations.sendMessageZodSchema.parseAsync({ body: { text: "a".repeat(501) } })).rejects.toThrow();
      await expect(AssistantValidations.sendMessageZodSchema.parseAsync({ body: { text: "Bonjour", mode: "admin" } })).rejects.toThrow();
    });
  });
});

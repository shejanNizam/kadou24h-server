import express from "express";
import httpStatus from "http-status";
import { IntlMessageFormat } from "intl-messageformat";
import request from "supertest";
import { z } from "zod";
import app from "../app";
import AppError from "../app/errorHelpers/AppError";
import { errorCatalog, errorCatalogParts, isErrorCode } from "../app/i18n/errors";
import { LOCALES, negotiateLocale } from "../app/i18n/locale";
import { translateError } from "../app/i18n/translate";
import { globalErrorHandler } from "../app/middlewares/globalErrorHandler";
import { resolveLocale } from "../app/middlewares/locale";
import validateRequest from "../app/middlewares/validateRequest";
import { passwordSchema } from "../app/modules/user/user.validation";

/** Every {argument} a message uses, including those inside plural/select branches */
interface AstNode {
  type: number;
  value?: unknown;
  options?: Record<string, { value: AstNode[] }>;
  children?: AstNode[];
}
const argumentsOf = (nodes: AstNode[], found = new Set<string>()): Set<string> => {
  for (const node of nodes) {
    // 1 argument · 2 number · 3 date · 4 time · 5 select · 6 plural
    if (node.type >= 1 && node.type <= 6 && typeof node.value === "string") found.add(node.value);
    Object.values(node.options ?? {}).forEach((option) => argumentsOf(option.value, found));
    if (node.children) argumentsOf(node.children, found);
  }
  return found;
};
const sorted = (set: Set<string>) => [...set].sort();

describe("Error catalog", () => {
  const entries = Object.entries(errorCatalog) as [string, Record<string, string>][];

  it("defines each code once across all parts", () => {
    const total = errorCatalogParts.reduce((sum, part) => sum + Object.keys(part).length, 0);
    expect(Object.keys(errorCatalog)).toHaveLength(total);
  });

  it("uses UPPER_SNAKE_CASE codes", () => {
    for (const [code] of entries) expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
  });

  it("has a non-empty, valid ICU text in every language", () => {
    for (const [code, texts] of entries) {
      for (const locale of LOCALES) {
        const text = texts[locale];
        expect({ code, locale, empty: !text?.trim() }).toEqual({ code, locale, empty: false });
        // A quote before a brace would silently escape the placeholder
        expect({ code, locale, quoteBrace: /'[{}]/.test(text) }).toEqual({ code, locale, quoteBrace: false });
        expect(() => new IntlMessageFormat(text, locale)).not.toThrow();
      }
    }
  });

  it("uses the same placeholders in every language", () => {
    for (const [code, texts] of entries) {
      const en = sorted(argumentsOf(new IntlMessageFormat(texts.en, "en").getAst() as AstNode[]));
      const fr = sorted(argumentsOf(new IntlMessageFormat(texts.fr, "fr").getAst() as AstNode[]));
      expect({ code, placeholders: fr }).toEqual({ code, placeholders: en });
    }
  });

  it("formats numbers and choices for the language", () => {
    expect(translateError("FILE_TOO_LARGE", "fr", { maxMb: 10 })).toBe("Fichier trop volumineux (10 Mo maximum).");
    expect(translateError("ACCOUNT_SUSPENDED", "en", { reason: "none" })).toBe("Your account is suspended.");
    expect(translateError("ACCOUNT_SUSPENDED", "fr", { reason: "Fraude" })).toBe("Votre compte est suspendu : Fraude");
    expect(translateError("OTP_INVALID", "fr", { remaining: 1 })).toBe("Code invalide. 1 tentative restante.");
    expect(translateError("OTP_INVALID", "en", { remaining: 3 })).toBe("Invalid code. 3 attempts remaining.");
    expect(translateError("MODE_NOT_APPROVED", "fr", { mode: "rider" })).toBe("Vous n'êtes pas encore un livreur approuvé.");
  });

  it("formats money with the language's digit grouping", () => {
    // French groups thousands with a narrow no-break space
    expect(translateError("COD_LIMIT", "fr", { limit: 500000 })).toBe(
      "Le paiement à la livraison est limité à 500 000 GNF par boutique. Payez en ligne.",
    );
    expect(translateError("COD_LIMIT", "en", { limit: 500000 })).toContain("above 500,000 GNF");
  });

  it("drops an optional part when its count is 0", () => {
    const params = { amount: 9000, left: 5000 };
    expect(translateError("REFUND_EXCEEDS_LEFT", "en", { ...params, waiting: 0 })).toBe(
      "Refund amount (9,000 GNF) exceeds what is left to refund (5,000 GNF).",
    );
    expect(translateError("REFUND_EXCEEDS_LEFT", "en", { ...params, waiting: 2000 })).toContain(
      "; 2,000 GNF is already waiting in a pending request",
    );
  });

  it("names statuses in words, and falls back to the raw value", () => {
    expect(translateError("SUB_ORDER_TRANSITION_INVALID", "fr", { from: "new", to: "ready_for_pickup" })).toBe(
      "Cette commande ne peut pas passer de « nouvelle » à « prête pour l'enlèvement ».",
    );
    expect(translateError("PICKUP_WRONG_STATUS", "en", { status: "in_transit" })).toBe(
      "Cannot verify pickup while the delivery is in transit.",
    );
    expect(translateError("ASSIGN_WRONG_STATUS", "en", { status: "lost" })).toContain("while the delivery is lost.");
    expect(translateError("TOO_MANY_ACTIVE_DELIVERIES", "fr", { max: 1 })).toBe(
      "Terminez d'abord votre livraison en cours (1 à la fois).",
    );
  });

  it("never throws on a missing value (the error answer must always be built)", () => {
    expect(translateError("FILE_TOO_LARGE", "en")).toContain("File too large");
  });
});

describe("negotiateLocale", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["fr", "fr"],
    ["en-GB,en;q=0.9", "en"],
    ["FR-gn", "fr"],
    ["de,en;q=0.5,fr;q=0.8", "fr"],
    ["en;q=0,fr", "fr"],
    ["*", undefined],
    ["de, es", undefined],
    ["en;q=0.8, fr;q=0.8", "en"],
  ])("%p → %p", (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});

describe("AppError", () => {
  it("keeps English text for logs and carries the code and params", () => {
    const error = new AppError(httpStatus.REQUEST_ENTITY_TOO_LARGE, "FILE_TOO_LARGE", { maxMb: 10 });
    expect(error.code).toBe("FILE_TOO_LARGE");
    expect(error.params).toEqual({ maxMb: 10 });
    expect(error.message).toBe("File too large (10 MB maximum).");
    expect(isErrorCode(error.code)).toBe(true);
  });

  it("only accepts codes from the catalog (checked by the compiler)", () => {
    // @ts-expect-error -- English text is not an ErrorCode: every reason lives in the catalog
    const withText = () => new AppError(httpStatus.BAD_REQUEST, "Some old message");
    expect(typeof withText).toBe("function");
  });
});

describe("Error answers", () => {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(resolveLocale);
  testApp.post("/validated", validateRequest(z.object({ name: z.string(), age: z.number().min(18) })), (_req, res) => {
    res.json({ success: true });
  });
  testApp.post("/password", validateRequest(z.object({ password: passwordSchema })), (_req, res) => {
    res.json({ success: true });
  });
  testApp.get("/coded", () => {
    throw new AppError(httpStatus.FORBIDDEN, "ACCOUNT_BANNED", { reason: "Spam" });
  });
  testApp.get("/dated", () => {
    // 23:30 UTC on 2 March is still 2 March in Conakry (UTC+0), whatever the server's zone
    throw new AppError(httpStatus.FORBIDDEN, "CHAT_RESTRICTED", { until: new Date("2026-03-02T23:30:00Z") });
  });
  testApp.get("/crash", () => {
    throw new Error("database exploded");
  });
  testApp.use(globalErrorHandler);

  it("answers in French by default", async () => {
    const res = await request(testApp).get("/coded");
    expect(res.status).toBe(403);
    expect(res.headers["content-language"]).toBe("fr");
    expect(res.body).toEqual({
      success: false,
      code: "ACCOUNT_BANNED",
      message: "Votre compte est banni : Spam",
      params: { reason: "Spam" },
      errorSources: [],
    });
  });

  it("answers in the language the client asks for", async () => {
    const res = await request(testApp).get("/coded").set("Accept-Language", "en-US,en;q=0.9");
    expect(res.headers["content-language"]).toBe("en");
    expect(res.headers.vary).toMatch(/Accept-Language/);
    expect(res.body.message).toBe("Your account is banned: Spam");
  });

  it("writes dates in the language, in Guinea's time", async () => {
    const fr = await request(testApp).get("/dated");
    expect(fr.body.message).toMatch(/jusqu'au 2 mars (à )?23:30 /);
    expect(fr.body.params).toEqual({ until: "2026-03-02T23:30:00.000Z" });
    const en = await request(testApp).get("/dated").set("Accept-Language", "en");
    expect(en.body.message).toMatch(/until (March 2|2 March),? (at )?11:30\sPM due/);
  });

  it("translates Zod's own messages and names the first field", async () => {
    const fr = await request(testApp).post("/validated").send({ age: 12 });
    expect(fr.status).toBe(400);
    expect(fr.body.code).toBe("VALIDATION_FAILED");
    expect(fr.body.message).toBe("name: Ce champ est obligatoire.");
    expect(fr.body.errorSources).toHaveLength(2);

    const en = await request(testApp).post("/validated").set("Accept-Language", "en").send({ age: 12 });
    expect(en.body.message).toBe("name: This field is required.");
    expect(en.body.errorSources[1].message).toMatch(/too small/i);
  });

  it("translates codes written on a schema, with the check's limits", async () => {
    const fr = await request(testApp).post("/password").send({ password: "abc" });
    expect(fr.body.code).toBe("VALIDATION_FAILED");
    expect(fr.body.errorSources.map((e: { message: string }) => e.message)).toEqual([
      "Le mot de passe doit contenir au moins 8 caractères.",
      "Le mot de passe doit contenir au moins 1 chiffre.",
    ]);
    const en = await request(testApp).post("/password").set("Accept-Language", "en").send({ password: "abc" });
    expect(en.body.message).toBe("password: Password must be at least 8 characters long.");
  });

  it("answers a broken JSON body with its own code", async () => {
    const res = await request(testApp).post("/validated").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_JSON", message: "Le corps de la requête n'est pas un JSON valide." });
  });

  it("hides unexpected errors behind INTERNAL_ERROR", async () => {
    const res = await request(testApp).get("/crash");
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
  });

  it("answers an unknown API route in the same shape", async () => {
    const res = await request(app).get("/api/v1/this-route-does-not-exist").set("Accept-Language", "en");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      code: "ROUTE_NOT_FOUND",
      message: "This API route does not exist.",
      errorSources: [],
    });
  });
});

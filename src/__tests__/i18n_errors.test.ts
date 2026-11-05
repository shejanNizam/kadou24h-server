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

/** Every {argument} a message uses, including those inside plural/select branches */
type AstNode = { type: number; value?: unknown; options?: Record<string, { value: AstNode[] }>; children?: AstNode[] };
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

  it("still accepts a legacy text message (no code)", () => {
    const error = new AppError(httpStatus.BAD_REQUEST, "Some old message");
    expect(error.code).toBeUndefined();
    expect(error.message).toBe("Some old message");
  });
});

describe("Error answers", () => {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(resolveLocale);
  testApp.post("/validated", validateRequest(z.object({ name: z.string(), age: z.number().min(18) })), (_req, res) => {
    res.json({ success: true });
  });
  testApp.get("/coded", () => {
    throw new AppError(httpStatus.FORBIDDEN, "ACCOUNT_BANNED", { reason: "Spam" });
  });
  testApp.get("/legacy", () => {
    throw new AppError(httpStatus.CONFLICT, "Old English text");
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

  it("gives a legacy text error the generic code of its status", async () => {
    const res = await request(testApp).get("/legacy");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "CONFLICT", message: "Old English text" });
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

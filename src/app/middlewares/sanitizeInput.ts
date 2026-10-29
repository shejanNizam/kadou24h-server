import { NextFunction, Request, Response } from "express";
import { sanitize } from "express-xss-sanitizer";

/**
 * Strips HTML tags from body, params, headers and query, like express-xss-sanitizer's xss(),
 * but gives "&" back: the sanitizer stores "Riz & Co" as "Riz &amp; Co", which the app and
 * admin then show as is. Only "&amp;" is undone; "&lt;" / "&gt;" stay escaped, so no tag
 * can come back. Passwords keep the old encoding: their hashes were made from it.
 */
const PASSWORD_KEYS = new Set(["password", "oldPassword", "newPassword"]);

const restoreAmpersands = (value: unknown, key?: string): unknown => {
  if (typeof value === "string") return key && PASSWORD_KEYS.has(key) ? value : value.replace(/&amp;/g, "&");
  if (Array.isArray(value)) return value.map((item) => restoreAmpersands(item));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) (value as Record<string, unknown>)[k] = restoreAmpersands(v, k);
  }
  return value;
};

const clean = <T>(data: T): T => restoreAmpersands(sanitize(data)) as T;

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body) req.body = clean(req.body);
  if (req.params) req.params = clean(req.params);
  if (req.headers) req.headers = clean(req.headers);
  // req.query is a getter in Express 5: redefine it, as the library does
  Object.defineProperty(req, "query", { value: clean({ ...req.query }), writable: false, configurable: true, enumerable: true });
  next();
};

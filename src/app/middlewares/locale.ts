import type { NextFunction, Request, Response } from "express";
import { negotiateLocale } from "../i18n/locale";

/**
 * Reads the language the client asks for (Accept-Language) into `req.locale`.
 * Without a usable header it stays unset: checkAuth then uses the signed-in
 * user's saved language, and anything else falls back to French.
 */
export const resolveLocale = (req: Request, res: Response, next: NextFunction) => {
  req.locale = negotiateLocale(req.headers["accept-language"]);
  // Answers differ by language: caches must keep one copy per language
  res.vary("Accept-Language");
  next();
};

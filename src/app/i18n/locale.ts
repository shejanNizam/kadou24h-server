import type { Request } from "express";

/** Languages the API answers in. French is the platform language (Guinea). */
export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * Picks the best supported language from an Accept-Language header
 * ("en-GB,en;q=0.9,fr;q=0.8" → "en"). Region tags match their base language;
 * entries with q=0 and the wildcard are ignored. Undefined when nothing matches.
 */
export function negotiateLocale(header: string | undefined): Locale | undefined {
  if (!header) return undefined;

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...attrs] = part.trim().split(";");
      const qAttr = attrs.find((attr) => attr.trim().startsWith("q="));
      const q = qAttr ? Number(qAttr.trim().slice(2)) : 1;
      return { base: tag.trim().split("-")[0].toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.q > 0 && entry.base !== "*")
    // Highest quality first; the header order breaks ties
    .sort((a, b) => b.q - a.q || a.index - b.index);

  return ranked.find((entry) => isLocale(entry.base))?.base as Locale | undefined;
}

/** The language to answer this request in: the request's choice, else the default. */
export const localeOf = (req: Pick<Request, "locale">): Locale => req.locale ?? DEFAULT_LOCALE;

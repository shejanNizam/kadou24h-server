import { IntlMessageFormat } from "intl-messageformat";
import { logger } from "../utils/logger";
import { errorCatalog, type ErrorCode } from "./errors";
import type { Locale } from "./locale";

/** Values for a message's {placeholders}. Numbers and dates are formatted for the language. */
export type MessageParams = Record<string, string | number | Date>;

/**
 * Named date styles for messages: "{until, date, day}" → "12 mars" / "12 March".
 * Dates are shown in Guinea's time, where the app runs, whatever the server's zone.
 */
const FORMATS = {
  date: {
    day: { day: "numeric", month: "long", timeZone: "Africa/Conakry" },
    dayTime: { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Conakry" },
  },
} satisfies ConstructorParameters<typeof IntlMessageFormat>[2];

// Parsing an ICU message is the costly part: each (language, text) is compiled once
const compiled = new Map<string, IntlMessageFormat>();

/**
 * Formats an ICU message ("{count, plural, one {# try} other {# tries}} left").
 * Never throws: a broken message or a missing value is logged and the raw text is
 * returned, so an error response can always be built.
 */
export function formatMessage(template: string, locale: Locale, params?: MessageParams): string {
  const key = `${locale}\u0000${template}`;
  try {
    let format = compiled.get(key);
    if (!format) {
      format = new IntlMessageFormat(template, locale, FORMATS);
      compiled.set(key, format);
    }
    return String(format.format(params));
  } catch (error) {
    logger.warn("Message could not be formatted", { template, locale, error: (error as Error).message });
    return template;
  }
}

/** The text of an error code in a language. */
export const translateError = (code: ErrorCode, locale: Locale, params?: MessageParams): string =>
  formatMessage(errorCatalog[code][locale], locale, params);

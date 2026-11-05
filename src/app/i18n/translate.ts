import { IntlMessageFormat } from "intl-messageformat";
import { logger } from "../utils/logger";
import { errorCatalog, type ErrorCode } from "./errors";
import type { Locale } from "./locale";

/** Values for a message's {placeholders}. Numbers and dates are formatted for the language. */
export type MessageParams = Record<string, string | number | Date>;

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
      format = new IntlMessageFormat(template, locale);
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

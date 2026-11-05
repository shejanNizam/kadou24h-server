import type { Locale } from "../locale";

/**
 * One message in every language, as an ICU message:
 *   "Hello {name}"  ·  "{count, plural, one {# day} other {# days}}"  ·  "{amount, number} GNF"
 * A single quote right before a brace escapes it in ICU, so never write '{.
 */
export type LocalizedMessage = Record<Locale, string>;
export type LocalizedMessages = Record<string, LocalizedMessage>;

import { z } from "zod";
import type { Locale } from "./locale";
import { translateError } from "./translate";

const zodLocales = { fr: z.locales.fr(), en: z.locales.en() } as const;

/**
 * Zod's built-in messages in the request's language, passed per parse
 * (`schema.parse(data, { error: zodErrorMap(locale) })`). A message written on the
 * schema itself still wins over this one.
 */
export const zodErrorMap =
  (locale: Locale): z.core.$ZodErrorMap =>
  (issue) => {
    // A missing field reads better as "required" than "expected string, received undefined"
    if (issue.code === "invalid_type" && issue.input === undefined) {
      return translateError("FIELD_REQUIRED", locale);
    }
    return zodLocales[locale].localeError(issue);
  };

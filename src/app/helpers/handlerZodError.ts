import { ZodError } from "zod";
import { isErrorCode } from "../i18n/errors";
import type { Locale } from "../i18n/locale";
import { translateError, type MessageParams } from "../i18n/translate";
import { TErrorSources, TGenericErrorResponse } from "../interfaces/error.types";

type Issue = ZodError["issues"][number];

/** Limits of the failed check, for messages like "at least {minimum} characters" */
const limitsOf = (issue: Issue): MessageParams => {
  const params: MessageParams = {};
  if ("minimum" in issue && issue.minimum !== undefined) params.minimum = Number(issue.minimum);
  if ("maximum" in issue && issue.maximum !== undefined) params.maximum = Number(issue.maximum);
  return params;
};

/**
 * Zod's own messages are already in the request's language (validateRequest
 * passes zodErrorMap). Messages written on a schema are error codes, translated here.
 */
export const handlerZodError = (err: ZodError, locale: Locale): TGenericErrorResponse => {
  const errorSources: TErrorSources[] = err.issues.map((issue) => ({
    path: String(issue.path[issue.path.length - 1] ?? ""),
    message: isErrorCode(issue.message) ? translateError(issue.message, locale, limitsOf(issue)) : issue.message,
  }));

  // The first problem as a readable message, so clients that only show
  // `message` (dashboard toasts, the app) tell the user what to fix
  const first = errorSources[0];

  return {
    statusCode: 400,
    code: "VALIDATION_FAILED",
    message: first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : undefined,
    errorSources,
  };
};

import { ZodError } from "zod";
import {
  TErrorSources,
  TGenericErrorResponse,
} from "../interfaces/error.types";

export const handlerZodError = (err: ZodError): TGenericErrorResponse => {
  const errorSources: TErrorSources[] = err.issues.map((issue) => ({
    path: String(issue.path[issue.path.length - 1] ?? ""),
    message: issue.message,
  }));

  // The first problem as a readable message, so clients that only show
  // `message` (dashboard toasts, the app) tell the user what to fix
  const first = errorSources[0];
  const message = first
    ? `${first.path ? `${first.path}: ` : ""}${first.message}`
    : "Validation failed";

  return {
    statusCode: 400,
    message,
    errorSources,
  };
};

/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import { configs } from "../config/index";
import { deleteFromCloudinary } from "../config/cloudinary.config";
import { logger } from "../utils/logger";
import AppError from "../errorHelpers/AppError";
import { handleCastError } from "../helpers/handleCastError";
import { handlerDuplicateError } from "../helpers/handlerDuplicateError";
import { handlerValidationError } from "../helpers/handlerValidationError";
import { handlerZodError } from "../helpers/handlerZodError";
import type { ErrorCode } from "../i18n/errors";
import { localeOf } from "../i18n/locale";
import { translateError } from "../i18n/translate";
import { TGenericErrorResponse } from "../interfaces/error.types";

const swallowError = (): void => undefined;

const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_FILES = 10;

/** The code answered when an error has none of its own (legacy text errors, unknown failures) */
const GENERIC_CODES: Partial<Record<number, ErrorCode>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "BODY_TOO_LARGE",
  422: "UNPROCESSABLE",
  429: "TOO_MANY_REQUESTS",
  503: "SERVICE_UNAVAILABLE",
};

export const genericCodeFor = (statusCode: number): ErrorCode =>
  GENERIC_CODES[statusCode] ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");

/** Turns any thrown value into a status, a code and (optionally) a final text. */
function classify(err: any): TGenericErrorResponse {
  if (err?.code === 11000) return handlerDuplicateError(err);
  if (err?.name === "CastError") return handleCastError();
  if (err?.name === "ZodError") return handlerZodError(err);
  if (err?.name === "ValidationError") return handlerValidationError(err);

  if (err instanceof AppError) {
    return err.code
      ? { statusCode: err.statusCode, code: err.code, params: err.params }
      : // Legacy text error: its English text is kept until the throw gets a code
        { statusCode: err.statusCode, code: genericCodeFor(err.statusCode), message: err.message };
  }

  if (err?.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") return { statusCode: 413, code: "FILE_TOO_LARGE", params: { maxMb: MAX_UPLOAD_MB } };
    if (err.code === "LIMIT_FILE_COUNT") return { statusCode: 400, code: "TOO_MANY_FILES", params: { max: MAX_UPLOAD_FILES } };
    return { statusCode: 400, code: "INVALID_UPLOAD" };
  }
  if (err?.type === "entity.parse.failed") return { statusCode: 400, code: "INVALID_JSON" };
  if (err?.type === "entity.too.large") return { statusCode: 413, code: "BODY_TOO_LARGE" };

  // Unexpected: the details stay in the server log, never in a production answer
  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: configs.node_env !== "production" && err instanceof Error ? err.message : undefined,
  };
}

/**
 * Every error answer has the same shape:
 *   { success: false, code, message, errorSources, params? }
 * `code` is stable for clients to branch on; `message` is in the request's language.
 */
export const globalErrorHandler = async (
  err: any,
  req: express.Request,
  res: express.Response,
  // Express recognises an error handler by its four parameters
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: express.NextFunction,
) => {
  // Delete any files uploaded to Cloudinary if the request failed
  if (req.file) {
    await deleteFromCloudinary(req.file.path).catch(swallowError);
  }

  if (req.files) {
    const files = Array.isArray(req.files)
      ? req.files
      : Object.values(req.files as Record<string, Express.Multer.File[]>).flat();

    await Promise.all(
      files.map((f) => deleteFromCloudinary(f.path).catch(swallowError)),
    );
  }

  const { statusCode, code, params, message, errorSources = [] } = classify(err);
  const locale = localeOf(req);

  // Every server-side failure is logged (with the request id to find it)
  if (statusCode >= 500) {
    logger.error("Request failed", {
      requestId: (req as express.Request & { id?: string }).id,
      method: req.method,
      path: req.originalUrl?.split("?")[0],
      status: statusCode,
      code,
      error: err?.message,
      stack: err?.stack,
    });
  }

  const response: Record<string, unknown> = {
    success: false,
    code,
    message: message ?? translateError(code, locale, params),
    errorSources,
  };
  if (params) response.params = params;
  if (configs.node_env === "development") {
    response.err = err;
    response.stack = err?.stack;
  }
  res.status(statusCode).set("Content-Language", locale).json(response);
};

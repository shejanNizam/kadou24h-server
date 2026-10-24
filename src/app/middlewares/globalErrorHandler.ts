/* eslint-disable @typescript-eslint/no-unused-vars */
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
import { TErrorSources } from "../interfaces/error.types";

const swallowError = (_err: unknown): void => undefined;

export const globalErrorHandler = async (
  err: any,
  req: express.Request,
  res: express.Response,
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

  let errorSources: TErrorSources[] = [];
  let statusCode = 500;
  let message = "Something went wrong!";

  if (err.code === 11000) {
    const simplified = handlerDuplicateError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
  } else if (err.name === "CastError") {
    const simplified = handleCastError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
  } else if (err.name === "ZodError") {
    const simplified = handlerZodError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
    errorSources = simplified.errorSources as TErrorSources[];
  } else if (err.name === "ValidationError") {
    const simplified = handlerValidationError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
    errorSources = simplified.errorSources as TErrorSources[];
  } else if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err?.name === "MulterError") {
    // Upload limits (size, number of files)
    statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File too large (10 MB maximum)"
        : err.code === "LIMIT_FILE_COUNT"
          ? "Too many files (10 maximum)"
          : "Invalid upload";
  } else if (err?.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Invalid JSON body";
  } else if (err?.type === "entity.too.large") {
    statusCode = 413;
    message = "Request body too large";
  } else if (err instanceof Error) {
    // Unexpected: the details stay in the server log, never in the answer
    message = configs.node_env === "production" ? "Something went wrong!" : err.message;
  }

  // Every server-side failure is logged (with the request id to find it)
  if (statusCode >= 500) {
    logger.error("Request failed", {
      requestId: (req as express.Request & { id?: string }).id,
      method: req.method,
      path: req.originalUrl?.split("?")[0],
      status: statusCode,
      error: err?.message,
      stack: err?.stack,
    });
  }

  const response: Record<string, unknown> = { success: false, message, errorSources };
  if (configs.node_env === "development") {
    response.err = err;
    response.stack = err.stack;
  }
  res.status(statusCode).json(response);
};

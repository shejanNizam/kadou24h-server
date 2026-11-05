import type { ErrorCode } from "../i18n/errors";
import { translateError, type MessageParams } from "../i18n/translate";

/**
 * An expected failure with an HTTP status, answered by globalErrorHandler.
 *
 *   throw new AppError(httpStatus.NOT_FOUND, "ORDER_NOT_FOUND");
 *   throw new AppError(httpStatus.BAD_REQUEST, "OTP_INVALID", { remaining: 2 });
 *
 * The client gets the code, the params and the message in its language.
 * `message` itself stays English, for logs and Sentry.
 */
class AppError extends Error {
  public readonly statusCode: number;
  /** Stable reason for clients; add new ones to the catalog in i18n/errors */
  public readonly code: ErrorCode;
  /** Values for the message placeholders, also sent to the client */
  public readonly params?: MessageParams;

  constructor(statusCode: number, code: ErrorCode, params?: MessageParams) {
    super(translateError(code, "en", params));
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.params = params;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;

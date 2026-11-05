import { isErrorCode, type ErrorCode } from "../i18n/errors";
import { translateError, type MessageParams } from "../i18n/translate";

/**
 * English text from a throw that has not moved to an error code yet.
 * @deprecated Use an ErrorCode from i18n/errors. Removed once every throw has one.
 */
type LegacyMessage = string & {};

/**
 * An expected failure with an HTTP status, answered by globalErrorHandler.
 *
 *   throw new AppError(httpStatus.NOT_FOUND, "ORDER_NOT_FOUND");
 *   throw new AppError(httpStatus.BAD_REQUEST, "OTP_ATTEMPTS_LEFT", { count: 2 });
 *
 * The client gets the code, the params and the message in its language.
 * `message` itself stays English, for logs and Sentry.
 */
class AppError extends Error {
  public readonly statusCode: number;
  /** Stable reason for clients. Unset for legacy text errors (the handler then answers a generic code). */
  public readonly code?: ErrorCode;
  /** Values for the message placeholders, also sent to the client */
  public readonly params?: MessageParams;

  constructor(statusCode: number, codeOrMessage: ErrorCode | LegacyMessage, params?: MessageParams) {
    const code = isErrorCode(codeOrMessage) ? codeOrMessage : undefined;
    super(code ? translateError(code, "en", params) : codeOrMessage);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.params = params;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;

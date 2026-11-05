import type { ErrorCode } from "../i18n/errors";
import type { MessageParams } from "../i18n/translate";

export interface TErrorSources {
  path: string;
  message: string;
}

export interface TGenericErrorResponse {
  statusCode: number;
  code: ErrorCode;
  params?: MessageParams;
  /** Set only when the text is already final (e.g. the first validation issue); otherwise built from the code */
  message?: string;
  errorSources?: TErrorSources[];
}

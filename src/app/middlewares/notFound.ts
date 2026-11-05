import { Request, Response } from "express";
import httpStatus from "http-status";
import { localeOf } from "../i18n/locale";
import { translateError } from "../i18n/translate";

/** Unknown route: same answer shape as every other error */
export default function notFound(req: Request, res: Response) {
  const locale = localeOf(req);
  return res
    .status(httpStatus.NOT_FOUND)
    .set("Content-Language", locale)
    .json({
      success: false,
      code: "ROUTE_NOT_FOUND",
      message: translateError("ROUTE_NOT_FOUND", locale),
      errorSources: [],
    });
}

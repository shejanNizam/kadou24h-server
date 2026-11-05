import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { z, ZodTypeAny } from "zod";
import AppError from "../errorHelpers/AppError";
import { localeOf } from "../i18n/locale";
import { zodErrorMap } from "../i18n/zod";

/**
 * Validates the request with a Zod schema. Two schema styles are supported:
 *
 *   z.object({ name: ... })                    → validates req.body
 *   z.object({ body: z.object({ name: ... }),  → validates req.body (and
 *              query?: ..., params?: ... })       req.query / req.params when given)
 *
 * The parsed (cleaned, defaulted) values replace the originals, so controllers
 * always read plain `req.body.name`. Zod's own messages come in the request's language.
 */
const validateRequest = (schema: ZodTypeAny) => {
  const isEnvelope =
    schema instanceof z.ZodObject &&
    ["body", "query", "params"].some((key) => key in schema.shape);

  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (req.body?.data) {
        try {
          req.body = JSON.parse(req.body.data as string);
        } catch {
          throw new AppError(httpStatus.BAD_REQUEST, "INVALID_DATA_FIELD");
        }
      }

      // Express 5 leaves req.body undefined when a request has no body
      const body = req.body ?? {};
      const options = { error: zodErrorMap(localeOf(req)) };

      if (!isEnvelope) {
        req.body = await schema.parseAsync(body, options);
        return next();
      }

      const parsed = (await schema.parseAsync(
        { body, query: req.query, params: req.params },
        options,
      )) as { body?: unknown; query?: Record<string, unknown> };

      if (parsed.body !== undefined) req.body = parsed.body;
      // req.query is a getter in Express 5 — update it in place
      if (parsed.query) {
        Object.keys(req.query).forEach((k) => Reflect.deleteProperty(req.query, k));
        Object.assign(req.query, parsed.query);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export default validateRequest;

import { NextFunction, Request, Response } from "express";
import { z, ZodTypeAny } from "zod";

/**
 * Validates the request with a Zod schema. Two schema styles are supported:
 *
 *   z.object({ name: ... })                    → validates req.body
 *   z.object({ body: z.object({ name: ... }),  → validates req.body (and
 *              query?: ..., params?: ... })       req.query / req.params when given)
 *
 * The parsed (cleaned, defaulted) values replace the originals, so controllers
 * always read plain `req.body.name`.
 */
const validateRequest = (schema: ZodTypeAny) => {
  const isEnvelope =
    schema instanceof z.ZodObject &&
    ["body", "query", "params"].some((key) => key in schema.shape);

  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (req.body?.data) {
        req.body = JSON.parse(req.body.data as string);
      }

      // Express 5 leaves req.body undefined when a request has no body
      const body = req.body ?? {};

      if (!isEnvelope) {
        req.body = await schema.parseAsync(body);
        return next();
      }

      const parsed = (await schema.parseAsync({
        body,
        query: req.query,
        params: req.params,
      })) as { body?: unknown; query?: Record<string, unknown> };

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

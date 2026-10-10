import { Request } from "express";
import httpStatus from "http-status";
import AppError from "../errorHelpers/AppError";

/** First value of a query parameter as a string (`?a=1&a=2` → "1"). */
export const queryString = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return queryString(value[0]);
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" ? value : String(value);
};

/** req.query as a flat `{ key: string }` map — for services that take raw filters. */
export const flatQuery = (query: Request["query"]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(query)
      .map(([key, value]) => [key, queryString(value)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );

/**
 * A query parameter that must be one of an enum's (or list's) values.
 * Missing → undefined; invalid → 400 with the allowed values, instead of an
 * unchecked value reaching the database query.
 */
export const enumQuery = <T extends string>(
  value: unknown,
  allowed: Record<string, T> | readonly T[],
  name: string,
): T | undefined => {
  const text = queryString(value);
  if (text === undefined) return undefined;

  const options = (Array.isArray(allowed) ? allowed : Object.values(allowed)) as readonly T[];
  if (!options.includes(text as T)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid ${name} "${text}". Allowed: ${options.join(", ")}`,
    );
  }
  return text as T;
};

/** Optional numeric query parameter (page, limit…); non-numbers become undefined. */
export const numberQuery = (value: unknown): number | undefined => {
  const text = queryString(value);
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
};

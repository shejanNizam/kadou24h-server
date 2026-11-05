import { TGenericErrorResponse } from "../interfaces/error.types";

/** A malformed id in a query (e.g. GET /orders/abc) */
export const handleCastError = (): TGenericErrorResponse => ({
  statusCode: 400,
  code: "INVALID_ID",
});

import { TGenericErrorResponse } from "../interfaces/error.types";

/** MongoDB unique-index violation (E11000). Names the field, never echoes the value. */
export const handlerDuplicateError = (err: { keyValue?: Record<string, unknown>; keyPattern?: Record<string, unknown> }): TGenericErrorResponse => {
  const field = Object.keys(err.keyValue ?? err.keyPattern ?? {})[0] ?? "value";
  return {
    statusCode: 409,
    code: "DUPLICATE_VALUE",
    params: { field },
  };
};

import mongoose from "mongoose";
import { TErrorSources, TGenericErrorResponse } from "../interfaces/error.types";

/** Mongoose schema validation (a document failed its model rules on save) */
export const handlerValidationError = (err: mongoose.Error.ValidationError): TGenericErrorResponse => {
  const errorSources: TErrorSources[] = Object.values(err.errors).map((errorObject) => ({
    path: errorObject.path,
    message: errorObject.message,
  }));

  return {
    statusCode: 400,
    code: "VALIDATION_FAILED",
    errorSources,
  };
};

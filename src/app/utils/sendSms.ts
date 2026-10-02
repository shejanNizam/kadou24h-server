import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { logger } from "./logger";

interface SendSmsOptions {
  to: string; // E.164, e.g. +224620000000
  message: string;
}

/**
 * Provider-agnostic SMS sender.
 * Add a new provider (Orange SMS API, Twilio, Africa's Talking, ...) as a new
 * case below and extend SMS_PROVIDER in config — callers never change.
 */
export const sendSms = async ({ to, message }: SendSmsOptions) => {
  switch (configs.SMS.provider) {
    case "log": {
      // Never print OTPs to production logs — there is simply no SMS channel yet.
      if (configs.node_env === "production") {
        throw new AppError(503, "SMS provider is not configured");
      }
      logger.info(`[SMS:log] to ${to}: ${message}`);
      return;
    }
    default:
      throw new AppError(503, `SMS provider "${configs.SMS.provider}" is not supported`);
  }
};

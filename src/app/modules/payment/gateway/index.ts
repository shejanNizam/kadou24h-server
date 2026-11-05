/**
 * The payment gateway in use. PAYMENT_MODE=demo → the demo gateway (simulated in the
 * app). PAYMENT_MODE=live → PAYMENT_PROVIDER, which must be registered below.
 */
import httpStatus from "http-status";
import { configs } from "../../../config/index";
import AppError from "../../../errorHelpers/AppError";
import { demoGateway } from "./demo.gateway";
import { PaymentGateway } from "./gateway.interface";

// Add the aggregator here once its account and keys exist, e.g. { cinetpay: cinetpayGateway }
const GATEWAYS: Record<string, PaymentGateway> = {
  demo: demoGateway,
};

export const isDemoPayments = () => configs.payment_mode === "demo";

export const paymentGateway = (): PaymentGateway => {
  if (isDemoPayments()) return demoGateway;
  const gateway = configs.payment_provider ? GATEWAYS[configs.payment_provider] : undefined;
  if (!gateway || gateway === demoGateway) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, "PAYMENT_UNAVAILABLE");
  }
  return gateway;
};

/** The gateway a webhook URL names, only if it is the one in use */
export const gatewayForWebhook = (name: string): PaymentGateway | null => {
  if (isDemoPayments()) return null;
  const gateway = GATEWAYS[name];
  return gateway && gateway.name === configs.payment_provider ? gateway : null;
};

export type { PaymentGateway } from "./gateway.interface";

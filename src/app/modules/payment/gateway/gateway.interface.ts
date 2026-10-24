/**
 * One payment aggregator (Orange Money, Mobile Money and card through one account).
 * The rest of the server only talks to this interface: connecting the aggregator
 * the client picks = one new file next to demo.gateway.ts + PAYMENT_PROVIDER.
 *
 * Flow: initiatePayment → createCheckout (the app opens checkoutUrl) → the aggregator
 * calls POST /payments/webhook/:provider → parseWebhook → PaymentServices.handleWebhook.
 * fetchStatus covers a lost webhook: the app's "payment pending" screen polls it.
 */
import { PaymentMethod } from "../payment.interface";

export interface CheckoutRequest {
  paymentId: string;
  amount: number; // GNF, whole francs
  currency: "GNF";
  method: PaymentMethod;
  description: string;
  payer: { name?: string; phone?: string; email?: string };
}

export interface CheckoutResult {
  /** The aggregator's transaction id (unique) — webhooks and status checks find the payment by it */
  providerRef: string;
  /** Hosted payment page the app opens. None for the demo gateway */
  checkoutUrl?: string;
}

export interface GatewayEvent {
  providerRef?: string;
  paymentId?: string;
  status: "success" | "failed" | "pending";
  /** What the aggregator says it collected (GNF) — must match the payment */
  amount?: number;
  raw: Record<string, unknown>;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /** Exact bytes received, for signature checks */
  rawBody?: Buffer;
}

export interface PaymentGateway {
  /** Matches PAYMENT_PROVIDER and the :provider of the webhook URL */
  name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /** Verifies the signature and reads the notification. Throw on a bad signature; null = nothing to do */
  parseWebhook(request: WebhookRequest): Promise<GatewayEvent | null>;
  /** Asks the aggregator for the current status of one payment */
  fetchStatus?(payment: { paymentId: string; providerRef?: string }): Promise<GatewayEvent | null>;
}

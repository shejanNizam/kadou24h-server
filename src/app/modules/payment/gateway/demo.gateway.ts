/**
 * Demo gateway (PAYMENT_MODE=demo): nothing leaves the server. The payment stays
 * pending until the app's "Simulate: paid / failed" buttons (POST /payments/:id/dev-confirm).
 */
import crypto from "crypto";
import { PaymentGateway } from "./gateway.interface";

export const demoGateway: PaymentGateway = {
  name: "demo",
  async createCheckout(request) {
    return { providerRef: `DEMO_${request.method.toUpperCase()}_${Date.now()}_${crypto.randomInt(1000, 10000)}` };
  },
  // Demo payments are confirmed by dev-confirm, never by a webhook
  async parseWebhook() {
    return null;
  },
};

/**
 * Payment / STK Push adapter (server-only).
 *
 * PRODUCTION GATE: the payment provider documentation and credentials have not
 * been supplied. No endpoints, credentials, callback field names, or success
 * codes are invented here. In test mode the adapter records an intent and waits
 * for an explicitly simulated callback; in live mode it refuses to run until a
 * real provider implementation is registered.
 */

export interface StkPushRequest {
  intentId: string;
  rideReference: string;
  amount: number;
  msisdn: string;
  idempotencyKey: string;
}

export interface StkPushResult {
  accepted: boolean;
  status: "awaiting_confirmation" | "failed" | "blocked_provider_gate";
  provider: string;
  mode: "test" | "live";
  providerReference: string | null;
  message: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

export interface PaymentProvider {
  name: string;
  configured: boolean;
  initiateStkPush(request: StkPushRequest): Promise<StkPushResult>;
  verifyCallbackSignature(rawBody: string, headers: Headers): boolean;
}

/** Placeholder provider used until real documentation is supplied. */
const unconfiguredProvider: PaymentProvider = {
  name: "unconfigured",
  configured: false,
  async initiateStkPush(request) {
    const testMode = process.env["PAYMENTS_TEST_MODE"] !== "false";
    if (!testMode) {
      return {
        accepted: false,
        status: "blocked_provider_gate",
        provider: "unconfigured",
        mode: "live",
        providerReference: null,
        message:
          "Live payments are blocked: the STK Push provider documentation and credentials have not been configured.",
        request: { intentId: request.intentId, amount: request.amount },
        response: {},
      };
    }
    return {
      accepted: true,
      status: "awaiting_confirmation",
      provider: "unconfigured",
      mode: "test",
      providerReference: `TEST-${request.idempotencyKey.slice(0, 18)}`,
      message:
        "Test mode: no live STK request was sent. A verified callback must still confirm this payment.",
      request: {
        intentId: request.intentId,
        rideReference: request.rideReference,
        amount: request.amount,
        msisdn: `${request.msisdn.slice(0, 7)}***`,
      },
      response: { note: "Awaiting simulated verified callback in test mode." },
    };
  },
  verifyCallbackSignature(rawBody, headers) {
    const secret = process.env["PAYMENT_CALLBACK_SECRET"];
    if (!secret) return false;
    return headers.get("x-callback-token") === secret && rawBody.length > 0;
  },
};

export function getPaymentProvider(): PaymentProvider {
  // When the provider documentation is supplied, register the real
  // implementation here and keep this call site unchanged.
  return unconfiguredProvider;
}

export function paymentMode(): "test" | "live" {
  return process.env["PAYMENTS_TEST_MODE"] === "false" ? "live" : "test";
}

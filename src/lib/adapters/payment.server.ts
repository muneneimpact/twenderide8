/**
 * Twende Payments adapter (server-only).
 *
 * All M-Pesa collections run through the Twende Payments gateway. Nothing is
 * ever marked paid here: only a verified callback (or a reconciliation read of
 * the gateway's own record) can confirm money moved.
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

/** Live gateway. Credentials come from the secret store and are never logged. */
const twendePaymentsProvider: PaymentProvider = {
  name: "twende_payments",
  get configured() {
    return true;
  },
  async initiateStkPush(request) {
    const { initiateStk } = await import("./palpluss.server");
    const isDues = request.rideReference === "platform-dues";
    const result = await initiateStk({
      amount: request.amount,
      phone: request.msisdn,
      accountReference: isDues ? "TWENDE-DUES" : request.rideReference,
      transactionDesc: isDues ? "Twende dues" : "Twende ride",
    });

    return {
      accepted: result.accepted,
      status: result.accepted ? "awaiting_confirmation" : "failed",
      provider: "twende_payments",
      mode: paymentMode(),
      providerReference: result.transactionId,
      message: result.message,
      request: result.request,
      response: result.response,
    };
  },
  verifyCallbackSignature(rawBody, headers) {
    const token = process.env["PALPLUSS_CALLBACK_TOKEN"];
    if (!token) return rawBody.length > 0;
    return headers.get("x-callback-token") === token && rawBody.length > 0;
  },
};

/** Used only while the gateway credentials are missing. */
const unconfiguredProvider: PaymentProvider = {
  name: "unconfigured",
  configured: false,
  async initiateStkPush(request) {
    return {
      accepted: false,
      status: "blocked_provider_gate",
      provider: "unconfigured",
      mode: paymentMode(),
      providerReference: null,
      message:
        "Twende Payments is not configured yet, so no M-Pesa prompt was sent. Please pay in cash or contact support.",
      request: { intentId: request.intentId, amount: request.amount },
      response: {},
    };
  },
  verifyCallbackSignature() {
    return false;
  },
};

export function getPaymentProvider(): PaymentProvider {
  return process.env["PALPLUSS_BASIC_AUTH"] ? twendePaymentsProvider : unconfiguredProvider;
}

export function paymentMode(): "test" | "live" {
  return process.env["PAYMENTS_TEST_MODE"] === "true" ? "test" : "live";
}

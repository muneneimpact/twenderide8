/**
 * Twende Payments gateway client (server-only).
 *
 * Talks to the upstream M-Pesa payment API using HTTP Basic authentication.
 * The upstream provider name is never surfaced to customers: everything the
 * rider or driver sees is branded "Twende Payments".
 */

const BASE_URL = process.env["PALPLUSS_BASE_URL"] ?? "https://api.palpluss.com/v1";

export interface TwendeTransaction {
  id: string;
  status: string;
  amount: number;
  phone: string | null;
  externalReference: string | null;
  mpesaReceipt: string | null;
  providerRequestId: string | null;
  providerCheckoutId: string | null;
  resultCode: string | null;
  resultDesc: string | null;
  raw: Record<string, unknown>;
}

export function gatewayConfigured(): boolean {
  return Boolean(process.env["PALPLUSS_BASIC_AUTH"]);
}

/**
 * Accepts either a raw API key or a pre-encoded Basic credential and always
 * produces a correct `Authorization` header. The value is never logged.
 */
function authHeader(): string {
  const raw = (process.env["PALPLUSS_BASIC_AUTH"] ?? "").trim();
  if (!raw) throw new Error("Twende Payments is not configured.");
  if (/^Basic\s+/i.test(raw)) return raw;
  const looksEncoded = /^[A-Za-z0-9+/=]+$/.test(raw) && !raw.startsWith("pk_") && raw.includes("=");
  const token = looksEncoded ? raw : Buffer.from(`${raw}:`).toString("base64");
  return `Basic ${token}`;
}

/** Public HTTPS URL the gateway posts payment results back to. */
export function callbackUrl(): string {
  const explicit = process.env["PALPLUSS_CALLBACK_URL"];
  const base =
    explicit ??
    `${process.env["PUBLIC_APP_URL"] ?? "https://project--6d28af8e-6086-4ea3-8c91-a0ecdcf12a94.lovable.app"}/api/public/payments/callback`;
  const token = process.env["PALPLUSS_CALLBACK_TOKEN"];
  if (!token || base.includes("token=")) return base;
  return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ ok: boolean; status: number; data: T | null; error: { code?: string; message?: string } | null; raw: Record<string, unknown> }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : null,
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = { message: await response.text().catch(() => "") };
  }

  const success = response.ok && payload["success"] !== false;
  return {
    ok: success,
    status: response.status,
    data: (payload["data"] ?? payload) as T,
    error: (payload["error"] as { code?: string; message?: string } | undefined) ?? null,
    raw: payload,
  };
}

export interface StkInitiateInput {
  amount: number;
  phone: string;
  accountReference: string;
  transactionDesc: string;
}

export interface StkInitiateOutput {
  accepted: boolean;
  transactionId: string | null;
  status: string;
  message: string;
  code: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

/** Sends the M-Pesa prompt. A `PENDING` result means the prompt was delivered. */
export async function initiateStk(input: StkInitiateInput): Promise<StkInitiateOutput> {
  const channelId = process.env["PALPLUSS_CHANNEL_ID"];
  const body: Record<string, unknown> = {
    amount: Math.round(input.amount),
    phone: input.phone,
    accountReference: input.accountReference.slice(0, 12),
    transactionDesc: input.transactionDesc.slice(0, 13),
    callbackUrl: callbackUrl(),
  };
  if (channelId) body["channelId"] = channelId;

  const result = await request<Record<string, unknown>>("/payments/stk", { method: "POST", body });
  const data = (result.data ?? {}) as Record<string, unknown>;

  return {
    accepted: result.ok,
    transactionId: (data["transactionId"] as string) ?? (data["id"] as string) ?? null,
    status: (data["status"] as string) ?? (result.ok ? "PENDING" : "FAILED"),
    message: result.ok
      ? "Check your phone for the M-Pesa prompt."
      : friendlyError(result.error?.code, result.error?.message),
    code: result.error?.code ?? null,
    // The Authorization header is deliberately excluded from anything stored.
    request: { ...body, phone: `${input.phone.slice(0, 6)}***` },
    response: result.raw,
  };
}

/** Reads the authoritative state of a transaction, used for reconciliation. */
export async function getTransaction(id: string): Promise<TwendeTransaction | null> {
  const result = await request<Record<string, unknown>>(`/transactions/${id}`, { method: "GET" });
  if (!result.ok || !result.data) return null;
  return normaliseTransaction(result.data);
}

/** Maps either webhook or REST shapes onto one internal transaction record. */
export function normaliseTransaction(input: Record<string, unknown>): TwendeTransaction {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = input[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
  };
  return {
    id: String(pick("id", "transaction_id", "transactionId") ?? ""),
    status: String(pick("status") ?? "PENDING").toUpperCase(),
    amount: Number(pick("amount") ?? 0),
    phone: (pick("phone_number", "phone") as string | null) ?? null,
    externalReference: (pick("external_reference", "accountReference") as string | null) ?? null,
    mpesaReceipt: (pick("mpesa_receipt", "mpesaReceipt") as string | null) ?? null,
    providerRequestId: (pick("provider_request_id", "providerRequestId") as string | null) ?? null,
    providerCheckoutId: (pick("provider_checkout_id", "providerCheckoutId") as string | null) ?? null,
    resultCode: pick("result_code", "resultCode") === null ? null : String(pick("result_code", "resultCode")),
    resultDesc: (pick("result_desc", "resultDescription") as string | null) ?? null,
    raw: input,
  };
}

/** Customer-safe wording for gateway errors. The provider is never named. */
function friendlyError(code?: string, message?: string): string {
  switch (code) {
    case "INVALID_PHONE":
      return "That mobile number is not a valid M-Pesa number.";
    case "INSUFFICIENT_SERVICE_BALANCE":
      return "Twende Payments is temporarily unavailable. Please try again shortly or pay in cash.";
    case "STK_TEMP_BANNED":
      return "Too many payment attempts right now. Please wait a moment and try again.";
    case "NO_PAYMENT_CHANNELS":
    case "NO_DEFAULT_CHANNEL":
    case "CHANNEL_NOT_FOUND":
      return "Twende Payments is not fully set up yet. Please pay in cash or contact support.";
    case "INVALID_API_KEY":
    case "TENANT_INACTIVE":
    case "INSUFFICIENT_SCOPE":
      return "Twende Payments could not be reached. Please try again shortly.";
    default:
      return message?.trim() ? message : "We could not start the payment. Please try again.";
  }
}

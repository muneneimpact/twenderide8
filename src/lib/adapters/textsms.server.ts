/**
 * TextSMS Kenya provider client (server-only).
 *
 * Credentials come from TEXTSMS_API_KEY / TEXTSMS_PARTNER_ID / TEXTSMS_SHORTCODE
 * and are read inside the call, never at module scope and never in the browser.
 * Nothing here ever fabricates a successful send: if the provider is not
 * configured or the response cannot be parsed, the result is a failure.
 */

const BASE = "https://sms.textsms.co.ke/api/services";

export interface TextSmsCredentials {
  apikey: string;
  partnerID: string;
  shortcode: string;
}

export function textSmsCredentials(): TextSmsCredentials | null {
  const apikey = process.env["TEXTSMS_API_KEY"];
  const partnerID = process.env["TEXTSMS_PARTNER_ID"];
  const shortcode = process.env["TEXTSMS_SHORTCODE"];
  if (!apikey || !partnerID || !shortcode) return null;
  return { apikey, partnerID, shortcode };
}

export function textSmsConfigured(): boolean {
  return textSmsCredentials() !== null;
}

/** TextSMS wants a bare MSISDN: 254712345678. */
export function toMsisdn(phone: string): string {
  const value = phone.replace(/[^\d]/g, "");
  if (/^254[17]\d{8}$/.test(value)) return value;
  if (/^0[17]\d{8}$/.test(value)) return `254${value.slice(1)}`;
  if (/^[17]\d{8}$/.test(value)) return `254${value}`;
  throw new Error("Enter a valid Kenyan mobile number, for example 0712 345 678.");
}

/** Strip anything outside the GSM-7 alphabet so transactional text stays 1 segment. */
export function gsm7(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "");
}

export const TEXTSMS_ERRORS: Record<string, { message: string; retryable: boolean }> = {
  "200": { message: "Message accepted by the provider.", retryable: false },
  "1001": { message: "Invalid sender ID.", retryable: false },
  "1002": { message: "Network not allowed.", retryable: false },
  "1003": { message: "Invalid mobile number.", retryable: false },
  "1004": { message: "Low SMS credits.", retryable: false },
  "1005": { message: "Provider system error.", retryable: true },
  "1006": { message: "Invalid credentials.", retryable: false },
  "1007": { message: "Provider system error.", retryable: true },
  "1008": { message: "No delivery report available.", retryable: false },
  "1009": { message: "Unsupported data type.", retryable: false },
  "1010": { message: "Unsupported request type.", retryable: false },
  "4090": { message: "Provider internal error. Retry after five minutes.", retryable: true },
  "4091": { message: "Partner ID missing.", retryable: false },
  "4092": { message: "API key missing.", retryable: false },
  "4093": { message: "Details not found.", retryable: false },
};

export interface TextSmsResponseRow {
  code: string;
  description: string;
  messageId: string | null;
  networkId: string | null;
  mobile: string | null;
  clientSmsId: string | null;
  accepted: boolean;
  retryable: boolean;
}

type Unknown = Record<string, unknown>;

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/**
 * The documented success property is misspelled `respose-code`; the correctly
 * spelled `response-code` is supported defensively. Only 200 is a success.
 */
export function parseResponseRow(row: Unknown): TextSmsResponseRow {
  const raw =
    row["respose-code"] ??
    row["response-code"] ??
    row["responseCode"] ??
    row["response_code"] ??
    row["code"];
  const code = str(raw) ?? "unknown";
  const known = TEXTSMS_ERRORS[code];
  const description =
    str(row["response-description"] ?? row["respose-description"] ?? row["description"]) ??
    known?.message ??
    "Unrecognised provider response.";
  return {
    code,
    description,
    messageId: str(row["messageid"] ?? row["messageId"] ?? row["message-id"]),
    networkId: str(row["networkid"] ?? row["networkId"] ?? row["network-id"]),
    mobile: str(row["mobile"]),
    clientSmsId: str(row["clientsmsid"] ?? row["clientSmsId"]),
    accepted: code === "200",
    retryable: code === "unknown" ? true : (known?.retryable ?? false),
  };
}

export function extractRows(payload: unknown): Unknown[] {
  if (Array.isArray(payload)) return payload as Unknown[];
  if (payload && typeof payload === "object") {
    const body = payload as Unknown;
    const responses = body["responses"];
    if (Array.isArray(responses)) return responses as Unknown[];
    return [body];
  }
  return [];
}

async function post(path: string, body: Unknown) {
  const response = await fetch(`${BASE}/${path}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { httpStatus: response.status, payload, text };
}

export interface SingleSendResult extends TextSmsResponseRow {
  httpStatus: number;
}

/** Send one transactional SMS. An HTTP 200 alone is never treated as accepted. */
export async function textSmsSend(mobile: string, message: string): Promise<SingleSendResult> {
  const creds = textSmsCredentials();
  if (!creds) throw new Error("SMS provider is not configured.");
  const { httpStatus, payload, text } = await post("sendsms", {
    apikey: creds.apikey,
    partnerID: creds.partnerID,
    shortcode: creds.shortcode,
    mobile: toMsisdn(mobile),
    message: gsm7(message),
  });
  const rows = extractRows(payload);
  if (rows.length === 0) {
    return {
      httpStatus,
      code: `http_${httpStatus}`,
      description: `Provider returned an unreadable response: ${text.slice(0, 200)}`,
      messageId: null,
      networkId: null,
      mobile: null,
      clientSmsId: null,
      accepted: false,
      retryable: httpStatus >= 500 || httpStatus === 429,
    };
  }
  return { httpStatus, ...parseResponseRow(rows[0] as Unknown) };
}

export interface BulkRecipient {
  mobile: string;
  message: string;
  clientsmsid: string;
}

/** Bulk send, capped at 20 recipients per call. Each response is read independently. */
export async function textSmsBulk(recipients: BulkRecipient[]): Promise<TextSmsResponseRow[]> {
  const creds = textSmsCredentials();
  if (!creds) throw new Error("SMS provider is not configured.");
  if (recipients.length === 0) return [];
  if (recipients.length > 20) throw new Error("Bulk SMS is limited to 20 recipients per call.");
  const { payload } = await post("sendbulk", {
    count: recipients.length,
    smslist: recipients.map((r) => ({
      apikey: creds.apikey,
      partnerID: creds.partnerID,
      shortcode: creds.shortcode,
      pass_type: "plain",
      mobile: toMsisdn(r.mobile),
      message: gsm7(r.message),
      clientsmsid: r.clientsmsid,
    })),
  });
  return extractRows(payload).map((row) => parseResponseRow(row));
}

/** Delivery report for one provider message ID. */
export async function textSmsDeliveryReport(messageID: string) {
  const creds = textSmsCredentials();
  if (!creds) throw new Error("SMS provider is not configured.");
  const { payload, httpStatus } = await post("getdlr", {
    apikey: creds.apikey,
    partnerID: creds.partnerID,
    messageID,
  });
  const row = extractRows(payload)[0] as Unknown | undefined;
  return {
    httpStatus,
    messageID,
    status: row ? (str(row["delivery-status"] ?? row["deliverystatus"] ?? row["status"]) ?? null) : null,
    description: row
      ? (str(row["delivery-description"] ?? row["description"]) ?? null)
      : "No delivery report returned.",
  };
}

/** SMS credit balance. Credentials are never echoed back to the caller. */
export async function textSmsBalance() {
  const creds = textSmsCredentials();
  if (!creds) throw new Error("SMS provider is not configured.");
  const { payload, httpStatus } = await post("getbalance", {
    apikey: creds.apikey,
    partnerID: creds.partnerID,
  });
  const row = (payload && typeof payload === "object" ? (payload as Unknown) : {}) as Unknown;
  return {
    httpStatus,
    credit: str(row["credit"] ?? row["balance"]),
    code: str(row["response-code"] ?? row["respose-code"]),
  };
}

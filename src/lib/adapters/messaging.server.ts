/**
 * SMS and email adapters (server-only).
 *
 * PRODUCTION GATE: SMS provider documentation and the verified Resend sender
 * address have not been supplied. Messages are always persisted to the
 * notification outbox; delivery is marked blocked_provider_gate until the
 * provider is configured, so nothing silently claims a delivery that never
 * happened.
 */

export interface OutboundMessage {
  to: string;
  subject?: string;
  body: string;
  templateCode: string;
}

export interface DeliveryResult {
  delivered: boolean;
  status: "sent" | "blocked_provider_gate" | "failed";
  provider: string;
  message: string;
}

export function smsConfigured(): boolean {
  return Boolean(process.env["SMS_API_KEY"] && process.env["SMS_SENDER_ID"]);
}

export function emailConfigured(): boolean {
  return Boolean(process.env["RESEND_API_KEY"] && process.env["RESEND_FROM_EMAIL"]);
}

export async function sendSms(_message: OutboundMessage): Promise<DeliveryResult> {
  if (!smsConfigured()) {
    return {
      delivered: false,
      status: "blocked_provider_gate",
      provider: "unconfigured",
      message: "SMS provider documentation and credentials are not configured yet.",
    };
  }
  // Real provider call is added here once the documentation is supplied.
  return {
    delivered: false,
    status: "blocked_provider_gate",
    provider: "unconfigured",
    message: "SMS credentials are present but no provider contract has been implemented yet.",
  };
}

export async function sendEmail(message: OutboundMessage): Promise<DeliveryResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM_EMAIL"];
  if (!apiKey || !from) {
    return {
      delivered: false,
      status: "blocked_provider_gate",
      provider: "resend",
      message: "Resend API key or verified sender address is not configured yet.",
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject ?? "Twende Ride",
        text: message.body,
        reply_to: process.env["RESEND_REPLY_TO"] ?? undefined,
      }),
    });
    if (!response.ok) {
      return {
        delivered: false,
        status: "failed",
        provider: "resend",
        message: `Email provider rejected the message (status ${response.status}).`,
      };
    }
    return { delivered: true, status: "sent", provider: "resend", message: "Email sent." };
  } catch {
    return { delivered: false, status: "failed", provider: "resend", message: "Email provider unreachable." };
  }
}

/**
 * SMS and email adapters (server-only).
 *
 * SMS goes through TextSMS Kenya, email through Resend. Both are honest: when
 * credentials are missing the result is blocked_provider_gate, never a
 * simulated success. Rich, logged, idempotent sending lives in comms.server.ts;
 * this module is the thin provider boundary.
 */
import { textSmsConfigured, textSmsSend } from "./textsms.server";

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
  return textSmsConfigured();
}

export function emailConfigured(): boolean {
  return Boolean(process.env["RESEND_API_KEY"]);
}

export async function sendSms(message: OutboundMessage): Promise<DeliveryResult> {
  if (!textSmsConfigured()) {
    return {
      delivered: false,
      status: "blocked_provider_gate",
      provider: "textsms",
      message: "TextSMS credentials are not configured yet, so no SMS was sent.",
    };
  }
  try {
    const result = await textSmsSend(message.to, message.body);
    return {
      delivered: result.accepted,
      status: result.accepted ? "sent" : "failed",
      provider: "textsms",
      message: result.description,
    };
  } catch (error) {
    return {
      delivered: false,
      status: "failed",
      provider: "textsms",
      message: error instanceof Error ? error.message : "SMS provider unreachable.",
    };
  }
}

export async function sendEmail(message: OutboundMessage): Promise<DeliveryResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return {
      delivered: false,
      status: "blocked_provider_gate",
      provider: "resend",
      message: "Resend API key is not configured yet.",
    };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Twende Meru Rides <ride@twendemeru.co.ke>",
        to: [message.to],
        reply_to: "ride@twendemeru.co.ke",
        subject: message.subject ?? "Twende Meru Rides",
        text: message.body,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      return {
        delivered: false,
        status: "failed",
        provider: "resend",
        message:
          response.status === 403
            ? "Resend rejected the send: twendemeru.co.ke still needs DNS verification."
            : `Email provider rejected the message (status ${response.status}). ${detail.slice(0, 160)}`,
      };
    }
    return { delivered: true, status: "sent", provider: "resend", message: "Email sent." };
  } catch {
    return { delivered: false, status: "failed", provider: "resend", message: "Email provider unreachable." };
  }
}

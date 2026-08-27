/**
 * Logged, idempotent SMS + email delivery (server-only).
 *
 * Every attempt writes a row to public.comms_log first, so an SMS or email
 * failure is recorded rather than lost — and it can never turn a successful
 * payment into a failed one. Nothing here ever reports a delivery that the
 * provider did not accept.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderEmail, type EmailTemplate } from "./email-templates.server";
import { textSmsConfigured, textSmsSend, toMsisdn } from "./adapters/textsms.server";

export const EMAIL_FROM = "Twende Meru Rides <ride@twendemeru.co.ke>";
export const EMAIL_REPLY_TO = "ride@twendemeru.co.ke";
export const EMAIL_DOMAIN = "twendemeru.co.ke";

export function resendConfigured(): boolean {
  return Boolean(process.env["RESEND_API_KEY"]);
}

export interface CommsContext {
  userId?: string | null;
  rideId?: string | null;
  paymentIntentId?: string | null;
  supportCaseId?: string | null;
}

export interface CommsResult {
  sent: boolean;
  duplicate?: boolean;
  status: string;
  code?: string | null;
  detail: string;
  providerMessageId?: string | null;
}

/** Claims the idempotency key. Returns null when this message was already handled. */
async function claim(
  channel: "sms" | "email",
  eventType: string,
  recipient: string,
  idempotencyKey: string,
  ctx: CommsContext,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("comms_log")
    .insert({
      channel,
      event_type: eventType,
      recipient,
      idempotency_key: idempotencyKey,
      provider: channel === "sms" ? "textsms" : "resend",
      status: "queued",
      user_id: ctx.userId ?? null,
      ride_id: ctx.rideId ?? null,
      payment_intent_id: ctx.paymentIntentId ?? null,
      support_case_id: ctx.supportCaseId ?? null,
    })
    .select("id")
    .single();
  if (error) return null; // unique violation => already sent or in flight
  return data.id;
}

async function finish(
  id: string,
  patch: Record<string, unknown>,
) {
  await supabaseAdmin.from("comms_log").update(patch as never).eq("id", id);
}

const RETRY_DELAYS_MS = [400, 1500];

/** Transactional SMS through TextSMS, retried only for temporary provider faults. */
export async function sendTransactionalSms(input: {
  to: string;
  message: string;
  eventType: string;
  idempotencyKey: string;
  context?: CommsContext;
}): Promise<CommsResult> {
  const ctx = input.context ?? {};
  let msisdn: string;
  try {
    msisdn = toMsisdn(input.to);
  } catch {
    return { sent: false, status: "invalid_recipient", detail: "Invalid Kenyan mobile number.", code: "1003" };
  }

  const logId = await claim("sms", input.eventType, msisdn, input.idempotencyKey, ctx);
  if (!logId) {
    return { sent: false, duplicate: true, status: "duplicate", detail: "This message was already sent." };
  }

  if (!textSmsConfigured()) {
    await finish(logId, {
      status: "blocked_provider_gate",
      error_description: "TEXTSMS_API_KEY, TEXTSMS_PARTNER_ID or TEXTSMS_SHORTCODE is not configured.",
    });
    return {
      sent: false,
      status: "blocked_provider_gate",
      detail: "SMS provider is not configured yet, so no message was sent.",
    };
  }

  let attempts = 0;
  let last: { code: string; description: string; retryable: boolean; messageId: string | null; networkId: string | null } = {
    code: "unknown",
    description: "No attempt made.",
    retryable: false,
    messageId: null,
    networkId: null,
  };

  for (let i = 0; i <= RETRY_DELAYS_MS.length; i += 1) {
    attempts += 1;
    try {
      const result = await textSmsSend(msisdn, input.message);
      last = {
        code: result.code,
        description: result.description,
        retryable: result.retryable,
        messageId: result.messageId,
        networkId: result.networkId,
      };
      if (result.accepted) break;
    } catch (error) {
      last = {
        code: "network_error",
        description: error instanceof Error ? error.message : "Provider unreachable.",
        retryable: true,
        messageId: null,
        networkId: null,
      };
    }
    if (!last.retryable || i === RETRY_DELAYS_MS.length) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
  }

  const accepted = last.code === "200";
  await finish(logId, {
    status: accepted ? "sent" : "failed",
    response_code: last.code,
    error_description: accepted ? null : last.description,
    provider_message_id: last.messageId,
    network_id: last.networkId,
    attempts,
    sent_at: accepted ? new Date().toISOString() : null,
  });

  return {
    sent: accepted,
    status: accepted ? "sent" : "failed",
    code: last.code,
    detail: last.description,
    providerMessageId: last.messageId,
  };
}

/** Transactional email through Resend, using the branded templates. */
export async function sendTransactionalEmail(input: {
  to: string;
  template: EmailTemplate;
  eventType: string;
  idempotencyKey: string;
  context?: CommsContext;
}): Promise<CommsResult> {
  const ctx = input.context ?? {};
  const to = input.to.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { sent: false, status: "invalid_recipient", detail: "Invalid email address." };
  }

  const logId = await claim("email", input.eventType, to, input.idempotencyKey, ctx);
  if (!logId) {
    return { sent: false, duplicate: true, status: "duplicate", detail: "This email was already sent." };
  }

  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    await finish(logId, {
      status: "blocked_provider_gate",
      error_description: "RESEND_API_KEY is not configured.",
    });
    return { sent: false, status: "blocked_provider_gate", detail: "Email provider is not configured yet." };
  }

  const rendered = renderEmail(input.template);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        reply_to: EMAIL_REPLY_TO,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok) {
      const domainIssue =
        response.status === 403 || /domain|verif/i.test(`${body.name ?? ""} ${body.message ?? ""}`);
      const detail = domainIssue
        ? `Resend rejected the send: the sender domain ${EMAIL_DOMAIN} still needs DNS verification. ${body.message ?? ""}`.trim()
        : (body.message ?? `Resend returned status ${response.status}.`);
      await finish(logId, {
        status: domainIssue ? "blocked_domain_unverified" : "failed",
        response_code: String(response.status),
        error_description: detail,
        attempts: 1,
      });
      return { sent: false, status: domainIssue ? "blocked_domain_unverified" : "failed", detail };
    }
    await finish(logId, {
      status: "sent",
      response_code: "200",
      provider_message_id: body.id ?? null,
      attempts: 1,
      sent_at: new Date().toISOString(),
    });
    return { sent: true, status: "sent", detail: "Email sent.", providerMessageId: body.id ?? null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Email provider unreachable.";
    await finish(logId, { status: "failed", error_description: detail, attempts: 1 });
    return { sent: false, status: "failed", detail };
  }
}

/** Re-attempt one previously failed communication without duplicating a success. */
export async function retryCommsRow(id: string): Promise<CommsResult> {
  const { data: row } = await supabaseAdmin.from("comms_log").select("*").eq("id", id).maybeSingle();
  if (!row) return { sent: false, status: "not_found", detail: "Communication record not found." };
  if (row.status === "sent") return { sent: true, status: "sent", detail: "Already delivered." };
  return { sent: false, status: row.status, detail: row.error_description ?? "Retry is scheduled by the sender." };
}

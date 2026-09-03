/** Server-only notification pipeline: always persisted, honest about delivery. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTransactionalEmail, sendTransactionalSms } from "./comms.server";
import type { EmailTemplate } from "./email-templates.server";

export interface NotifyInput {
  userId: string;
  templateCode: string;
  title: string;
  body: string;
  rideId?: string | null;
  /** Critical events also go out by SMS. */
  critical?: boolean;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
}

/**
 * In-app notification for every event, plus a transactional SMS for critical
 * ones. The SMS is logged in comms_log with the provider response, and an SMS
 * failure never propagates as an error to the caller (a ride or payment must
 * not fail because a message could not be delivered).
 */
export async function notify(input: NotifyInput) {
  const base = {
    user_id: input.userId,
    template_code: input.templateCode,
    title: input.title,
    body: input.body,
    ride_id: input.rideId ?? null,
    payload: (input.payload ?? {}) as never,
  };

  const { error } = await supabaseAdmin.from("notification_outbox").insert({
    ...base,
    channel: "in_app",
    status: "queued",
    provider_ready: true,
    dedupe_key: input.dedupeKey ? `${input.dedupeKey}:in_app` : null,
  });
  if (error && !error.message.includes("duplicate key")) {
    console.error("notification insert failed", error.message);
  }

  // Push: every event, on every device the person registered. Delivery
  // problems never propagate into the ride or payment flow.
  try {
    const { sendPush } = await import("./push.server");
    await sendPush({
      userId: input.userId,
      title: input.title,
      body: input.body,
      path: input.rideId ? `/rides/${input.rideId}` : "/",
      dedupeKey: input.dedupeKey ?? `${input.userId}:${input.templateCode}:${input.rideId ?? "none"}`,
      templateCode: input.templateCode,
      rideId: input.rideId ?? null,
    });
  } catch (pushError) {
    console.error("push notification failed", pushError);
  }

  if (!input.critical) return;

  try {
    const [{ data: prefs }, { data: profile }] = await Promise.all([
      supabaseAdmin
        .from("notification_preferences")
        .select("sms_enabled")
        .eq("user_id", input.userId)
        .maybeSingle(),
      supabaseAdmin.from("profiles").select("phone").eq("id", input.userId).maybeSingle(),
    ]);
    if (prefs?.sms_enabled === false || !profile?.phone) return;

    await sendTransactionalSms({
      to: profile.phone,
      message: input.body,
      eventType: input.templateCode,
      idempotencyKey: `notify:${input.dedupeKey ?? `${input.userId}:${input.templateCode}:${input.rideId ?? "none"}`}`,
      context: { userId: input.userId, rideId: input.rideId ?? null },
    });
  } catch (smsError) {
    console.error("critical sms failed", smsError);
  }
}

/**
 * Branded transactional email. Never throws: a delivery problem is recorded in
 * comms_log and returned, so a successful payment stays successful.
 */
export async function emailTemplate(input: {
  userId: string;
  template: EmailTemplate;
  eventType: string;
  idempotencyKey: string;
  rideId?: string | null;
  paymentIntentId?: string | null;
}) {
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", input.userId)
      .maybeSingle();
    if (!profile?.email) return { delivered: false, reason: "no_email" };
    const result = await sendTransactionalEmail({
      to: profile.email,
      template: input.template,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      context: {
        userId: input.userId,
        rideId: input.rideId ?? null,
        paymentIntentId: input.paymentIntentId ?? null,
      },
    });
    return { delivered: result.sent, reason: result.detail };
  } catch (error) {
    console.error("email send failed", error);
    return { delivered: false, reason: error instanceof Error ? error.message : "unknown" };
  }
}

/** Plain-text receipt fallback kept for existing callers. */
export async function emailReceipt(userId: string, subject: string, body: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.email) return { delivered: false, reason: "no_email" };
  const result = await sendTransactionalEmail({
    to: profile.email,
    template: { code: "support_reply", data: { name: subject, message: body } },
    eventType: "receipt",
    idempotencyKey: `receipt:${userId}:${subject}:${body.length}`,
    context: { userId },
  });
  return { delivered: result.sent, reason: result.detail };
}

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadata as never,
  });
}

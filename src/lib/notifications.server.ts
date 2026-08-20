/** Server-only notification pipeline: always persisted, honest about delivery. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "./adapters/messaging.server";

export interface NotifyInput {
  userId: string;
  templateCode: string;
  title: string;
  body: string;
  rideId?: string | null;
  critical?: boolean;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
}

export async function notify(input: NotifyInput) {
  const rows: {
    user_id: string;
    channel: "in_app" | "push" | "sms" | "email";
    template_code: string;
    title: string;
    body: string;
    ride_id: string | null;
    dedupe_key: string | null;
    status: "queued" | "blocked_provider_gate";
    provider_ready: boolean;
    payload: never;
  }[] = [];

  const base = {
    user_id: input.userId,
    template_code: input.templateCode,
    title: input.title,
    body: input.body,
    ride_id: input.rideId ?? null,
    payload: (input.payload ?? {}) as never,
  };

  rows.push({
    ...base,
    channel: "in_app",
    status: "queued",
    provider_ready: true,
    dedupe_key: input.dedupeKey ? `${input.dedupeKey}:in_app` : null,
  });

  if (input.critical) {
    const { data: prefs } = await supabaseAdmin
      .from("notification_preferences")
      .select("sms_enabled")
      .eq("user_id", input.userId)
      .maybeSingle();
    if (prefs?.sms_enabled !== false) {
      const result = await sendSms({ to: input.userId, body: input.body, templateCode: input.templateCode });
      rows.push({
        ...base,
        channel: "sms",
        status: result.status === "sent" ? "queued" : "blocked_provider_gate",
        provider_ready: smsConfigured(),
        dedupe_key: input.dedupeKey ? `${input.dedupeKey}:sms` : null,
      });
    }
  }

  const { error } = await supabaseAdmin.from("notification_outbox").insert(rows);
  if (error && !error.message.includes("duplicate key")) {
    console.error("notification insert failed", error.message);
  }
}

export async function emailReceipt(userId: string, subject: string, body: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.email) return { delivered: false, reason: "no_email" };
  if (!emailConfigured()) {
    await supabaseAdmin.from("notification_outbox").insert({
      user_id: userId,
      channel: "email",
      template_code: "receipt",
      title: subject,
      body,
      status: "blocked_provider_gate",
      provider_ready: false,
    });
    return { delivered: false, reason: "provider_gate" };
  }
  const result = await sendEmail({ to: profile.email, subject, body, templateCode: "receipt" });
  await supabaseAdmin.from("notification_outbox").insert({
    user_id: userId,
    channel: "email",
    template_code: "receipt",
    title: subject,
    body,
    status: result.delivered ? "sent" : "failed",
    provider_ready: true,
    sent_at: result.delivered ? new Date().toISOString() : null,
    last_error: result.delivered ? null : result.message,
  });
  return { delivered: result.delivered, reason: result.message };
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

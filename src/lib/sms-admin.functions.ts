import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Protected SMS operations. Every function here is restricted to operations and
 * super admins — there is no public bulk-messaging endpoint, and provider
 * credentials are never returned to the browser.
 */

/**
 * Test send. We do not query provider balances — a single real transactional
 * send to a chosen number is the honest readiness check.
 */
export const sendTestSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().min(9).max(20),
        message: z.string().min(4).max(160).default("Twende Meru: test message. No action needed."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    const { textSmsSend, textSmsConfigured } = await import("./adapters/textsms.server");
    await requireRole(context.userId, OPS);
    if (!textSmsConfigured()) throw new Error("SMS provider is not configured.");
    const result = await textSmsSend(data.phone, data.message);
    return {
      accepted: result.accepted,
      code: result.code,
      detail: result.description,
      messageId: result.messageId,
    };
  });


export const getSmsDeliveryReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ messageId: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { textSmsDeliveryReport, textSmsConfigured } = await import("./adapters/textsms.server");
    await requireRole(context.userId, OPS);
    if (!textSmsConfigured()) throw new Error("SMS provider is not configured.");
    const report = await textSmsDeliveryReport(data.messageId);
    if (report.status) {
      await supabaseAdmin
        .from("comms_log")
        .update({
          status: /deliver/i.test(report.status) ? "delivered" : "sent",
          delivered_at: /deliver/i.test(report.status) ? new Date().toISOString() : null,
          error_description: report.description,
        })
        .eq("provider_message_id", data.messageId);
    }
    return report;
  });

/** Bulk send, hard-capped at 20 recipients, each response recorded independently. */
export const sendBulkSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        message: z.string().min(4).max(320),
        recipients: z.array(z.string().min(9).max(20)).min(1).max(20),
        campaign: z.string().min(3).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { textSmsBulk, textSmsConfigured, toMsisdn } = await import("./adapters/textsms.server");
    const { audit } = await import("./notifications.server");
    await requireRole(context.userId, OPS);
    if (!textSmsConfigured()) throw new Error("SMS provider is not configured.");

    const stamp = Date.now();
    const list = data.recipients.map((phone, index) => ({
      mobile: toMsisdn(phone),
      message: data.message,
      clientsmsid: `${data.campaign}-${stamp}-${index}`,
    }));

    const rows = await textSmsBulk(list);
    const byClientId = new Map(rows.map((row) => [row.clientSmsId, row]));

    const records = list.map((item) => {
      const row = byClientId.get(item.clientsmsid) ?? rows[list.indexOf(item)];
      const accepted = row?.accepted ?? false;
      return {
        channel: "sms" as const,
        event_type: `bulk:${data.campaign}`,
        recipient: item.mobile,
        provider: "textsms",
        provider_message_id: row?.messageId ?? null,
        network_id: row?.networkId ?? null,
        status: accepted ? "sent" : "failed",
        response_code: row?.code ?? "unknown",
        error_description: accepted ? null : (row?.description ?? "No provider response for this recipient."),
        attempts: 1,
        idempotency_key: `bulk:${item.clientsmsid}`,
        sent_at: accepted ? new Date().toISOString() : null,
      };
    });
    await supabaseAdmin.from("comms_log").insert(records);
    await audit(context.userId, "sms.bulk_send", "comms_log", data.campaign, {
      recipients: list.length,
      accepted: records.filter((r) => r.status === "sent").length,
    });

    return {
      total: records.length,
      accepted: records.filter((r) => r.status === "sent").length,
      results: records.map((r) => ({
        recipient: r.recipient,
        status: r.status,
        code: r.response_code,
        detail: r.error_description,
      })),
    };
  });

/** Delivery failures across SMS and email for the operations console. */
export const listCommsFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireRole(context.userId, STAFF);
    const { data: rows } = await supabaseAdmin
      .from("comms_log")
      .select("*")
      .in("status", ["failed", "blocked_provider_gate", "blocked_domain_unverified"])
      .order("created_at", { ascending: false })
      .limit(data.limit);
    return rows ?? [];
  });

/** Provider readiness, for honest status badges in the admin console. */
export const getCommsHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    const { textSmsConfigured } = await import("./adapters/textsms.server");
    const { resendConfigured, emailFrom, emailDomain } = await import("./comms.server");
    await requireRole(context.userId, STAFF);
    return {
      sms: {
        provider: "TextSMS Kenya",
        configured: textSmsConfigured(),
        message: textSmsConfigured()
          ? "TextSMS credentials are present."
          : "Add TEXTSMS_API_KEY, TEXTSMS_PARTNER_ID and TEXTSMS_SHORTCODE to enable SMS.",
      },
      email: {
        provider: "Resend",
        configured: resendConfigured(),
        from: emailFrom(),
        domain: emailDomain(),
        message: resendConfigured()
          ? `Resend key present. ${emailDomain()} must be DNS-verified in Resend before mail is accepted.`
          : "Add RESEND_API_KEY to enable email.",
      },
    };
  });

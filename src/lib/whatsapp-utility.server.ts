import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normaliseKenyanPhone } from "./phone";

/** The payment-reminder template remains disabled until Meta approval is recorded in server config. */
export async function sendHirePaymentReminderTemplate(input: {
  userId: string;
  quoteId: string;
  reference: string;
  amount: string;
  dueDate: string;
  idempotencyKey: string;
}) {
  const approvedCodes = new Set(
    (process.env["WHATSAPP_APPROVED_TEMPLATE_CODES"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!approvedCodes.has("hire_payment_reminder")) {
    return { status: "template_not_approved" as const };
  }

  const { whatsappGatewayConfigured, whatsappGatewaySend } = await import("./whatsapp-gateway.server");
  if (!whatsappGatewayConfigured()) return { status: "not_configured" as const };

  const [{ data: preference }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from("notification_preferences")
      .select("whatsapp_enabled, whatsapp_opted_in_at")
      .eq("user_id", input.userId)
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("phone, full_name").eq("id", input.userId).maybeSingle(),
  ]);
  if (preference?.whatsapp_enabled !== true || !preference.whatsapp_opted_in_at) {
    return { status: "consent_not_enabled" as const };
  }
  if (!profile?.phone) return { status: "no_phone" as const };

  let phone: string;
  try {
    phone = normaliseKenyanPhone(profile.phone);
  } catch {
    return { status: "invalid_phone" as const };
  }

  let conversationId: string;
  const { data: existingConversation } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("id")
    .eq("customer_phone", phone)
    .maybeSingle();
  if (existingConversation) {
    conversationId = existingConversation.id;
  } else {
    const { data: created, error: createError } = await supabaseAdmin
      .from("whatsapp_conversations")
      .upsert(
        {
          customer_phone: phone,
          customer_name: profile.full_name ?? null,
          last_message_preview: "Hire payment reminder",
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "customer_phone", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (created) conversationId = created.id;
    else {
      const { data: raced } = await supabaseAdmin
        .from("whatsapp_conversations")
        .select("id")
        .eq("customer_phone", phone)
        .maybeSingle();
      if (raced) conversationId = raced.id;
      else return { status: "conversation_error" as const, detail: createError?.message };
    }
  }

  const body = `Payment reminder for hire ${input.reference}: ${input.amount} is requested by ${input.dueDate}. Open Twende Meru Rides to pay by M-Pesa.`;
  let messageId: string;
  const { data: previous } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, status")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (
    previous?.status === "sent" ||
    previous?.status === "delivered" ||
    previous?.status === "read"
  ) {
    return { status: "sent" as const, messageId: previous.id };
  }
  if (previous?.status === "sending") {
    return { status: "already_sending" as const, messageId: previous.id };
  }
  if (previous) {
    const { error } = await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "sending", error_message: null, body })
      .eq("id", previous.id);
    if (error) return { status: "log_error" as const, detail: error.message };
    messageId = previous.id;
  } else {
    const { data: message, error } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({
        conversation_id: conversationId,
        direction: "outbound",
        body,
        message_type: "template",
        status: "sending",
        sent_by: null,
        hire_quote_id: input.quoteId,
        idempotency_key: input.idempotencyKey,
      })
      .select("id")
      .single();
    if (error || !message) return { status: "log_error" as const, detail: error?.message };
    messageId = message.id;
  }

  let providerId: string;
  try {
    providerId = await whatsappGatewaySend({
      recipient_type: "individual",
      to: phone.replace(/\D/g, ""),
      type: "template",
      template: {
        name: process.env["WHATSAPP_HIRE_PAYMENT_TEMPLATE_NAME"] ?? "hire_payment_reminder",
        language: { code: "en_GB" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "request_reference", text: input.reference },
              { type: "text", parameter_name: "amount_due", text: input.amount },
              { type: "text", parameter_name: "due_date", text: input.dueDate },
            ],
          },
        ],
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Network error contacting WhatsApp.";
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "failed", error_message: detail.slice(0, 500) })
      .eq("id", messageId);
    return { status: "failed" as const, detail };
  }

  const now = new Date().toISOString();
  const [{ error: messageError }, { error: conversationError }] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: "sent", provider_message_id: providerId, error_message: null })
      .eq("id", messageId),
    supabaseAdmin
      .from("whatsapp_conversations")
      .update({
        last_message_at: now,
        last_message_preview: body.slice(0, 240),
        updated_at: now,
      })
      .eq("id", conversationId),
  ]);
  if (messageError)
    return { status: "sent_log_update_failed" as const, detail: messageError.message };
  if (conversationError)
    return { status: "sent_thread_update_failed" as const, detail: conversationError.message };
  return { status: "sent" as const, messageId };
}

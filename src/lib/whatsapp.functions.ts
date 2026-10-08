import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const OPS = ["ops_admin", "super_admin"] as const;

function whatsappSetup() {
  const configured = Boolean(process.env["LOVABLE_API_KEY"] && process.env["WHATSAPP_API_KEY"]);
  return {
    sendConfigured: configured,
    webhookConfigured: configured,
    missing: [
      !process.env["LOVABLE_API_KEY"] ? "LOVABLE_API_KEY" : null,
      !process.env["WHATSAPP_API_KEY"] ? "WhatsApp connection" : null,
    ].filter((value): value is string => Boolean(value)),
  };
}

export const listWhatsAppConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole } = await import("./authz.server");
    await requireRole(context.userId, [...OPS]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select(
        "id, customer_phone, customer_name, last_message_preview, last_inbound_at, last_message_at, unread_count",
      )
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`Could not load WhatsApp conversations: ${error.message}`);
    const now = Date.now();
    return {
      conversations: (data ?? []).map((conversation) => ({
        ...conversation,
        service_window_open: Boolean(
          conversation.last_inbound_at &&
          now - new Date(conversation.last_inbound_at).getTime() < CUSTOMER_SERVICE_WINDOW_MS,
        ),
      })),
      sendConfigured: whatsappSetup().sendConfigured,
      webhookConfigured: whatsappSetup().webhookConfigured,
      missing: whatsappSetup().missing,
    };
  });

export const getWhatsAppThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./authz.server");
    await requireRole(context.userId, [...OPS]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [
      { data: conversation, error: conversationError },
      { data: messages, error: messagesError },
    ] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_conversations")
        .select("id, customer_phone, customer_name, last_inbound_at, last_message_at, unread_count")
        .eq("id", data.conversationId)
        .maybeSingle(),
      supabaseAdmin
        .from("whatsapp_messages")
        .select("id, direction, body, message_type, status, error_message, created_at, sent_by")
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: true })
        .limit(1000),
    ]);
    if (conversationError) throw new Error(conversationError.message);
    if (messagesError) throw new Error(messagesError.message);
    if (!conversation) throw new Error("That WhatsApp conversation no longer exists.");
    if (conversation.unread_count > 0) {
      await supabaseAdmin
        .from("whatsapp_conversations")
        .update({ unread_count: 0 })
        .eq("id", data.conversationId);
    }
    return {
      conversation: { ...conversation, unread_count: 0 },
      messages: messages ?? [],
      serviceWindowOpen: Boolean(
        conversation.last_inbound_at &&
        Date.now() - new Date(conversation.last_inbound_at).getTime() < CUSTOMER_SERVICE_WINDOW_MS,
      ),
    };
  });

export const sendWhatsAppReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ conversationId: z.string().uuid(), body: z.string().trim().min(1).max(4096) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole } = await import("./authz.server");
    await requireRole(context.userId, [...OPS]);
    const config = whatsappSetup();
    if (!config.sendConfigured || !config.token || !config.phoneNumberId) {
      throw new Error(
        `WhatsApp sending is not configured. Add ${config.missing.join(", ")} to the server environment.`,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conversation, error: conversationError } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select("id, customer_phone, last_inbound_at")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation) throw new Error("That WhatsApp conversation no longer exists.");
    const lastInbound = conversation.last_inbound_at
      ? new Date(conversation.last_inbound_at).getTime()
      : 0;
    if (!lastInbound || Date.now() - lastInbound >= CUSTOMER_SERVICE_WINDOW_MS) {
      throw new Error(
        "The 24-hour customer-service window is closed. Send an approved WhatsApp template after it has been approved in WhatsApp Manager.",
      );
    }

    const { data: message, error: insertError } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({
        conversation_id: conversation.id,
        direction: "outbound",
        body: data.body,
        message_type: "text",
        status: "sending",
        sent_by: context.userId,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(`Could not save the outgoing message: ${insertError.message}`);

    let response: Response;
    let payload: Record<string, unknown> = {};
    try {
      response = await fetch(
        `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: conversation.customer_phone.replace(/\D/g, ""),
            type: "text",
            text: { preview_url: false, body: data.body },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Network error while contacting WhatsApp.";
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({ status: "failed", error_message: messageText.slice(0, 500) })
        .eq("id", message.id);
      throw new Error(`WhatsApp send failed: ${messageText}`);
    }

    const metaError = payload["error"] as { message?: unknown } | undefined;
    const returnedMessages = payload["messages"] as Array<{ id?: string }> | undefined;
    const providerId = returnedMessages?.[0]?.id ?? null;
    if (!response.ok || !providerId) {
      const errorText = String(
        metaError?.message ?? `WhatsApp API returned HTTP ${response.status}.`,
      ).slice(0, 500);
      await supabaseAdmin
        .from("whatsapp_messages")
        .update({ status: "failed", error_message: errorText })
        .eq("id", message.id);
      throw new Error(`WhatsApp send failed: ${errorText}`);
    }

    const now = new Date().toISOString();
    const [{ error: messageUpdateError }, { error: conversationUpdateError }] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_messages")
        .update({ status: "sent", provider_message_id: providerId })
        .eq("id", message.id),
      supabaseAdmin
        .from("whatsapp_conversations")
        .update({
          last_message_at: now,
          last_message_preview: data.body.slice(0, 240),
          unread_count: 0,
          updated_at: now,
        })
        .eq("id", conversation.id),
    ]);
    if (messageUpdateError)
      throw new Error(
        `WhatsApp accepted the message but its local status could not be updated: ${messageUpdateError.message}`,
      );
    if (conversationUpdateError)
      throw new Error(
        `WhatsApp accepted the message but the conversation could not be updated: ${conversationUpdateError.message}`,
      );
    return { ok: true, status: "sent" as const, messageId: message.id };
  });

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const verifyToken = process.env["WHATSAPP_VERIFY_TOKEN"];
        if (!verifyToken)
          return new Response("WhatsApp webhook is not configured", { status: 503 });
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && token === verifyToken && challenge) {
          return new Response(challenge, {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const appSecret = process.env["WHATSAPP_APP_SECRET"];
        if (!appSecret) return new Response("WhatsApp webhook is not configured", { status: 503 });
        const rawBody = await request.text();
        if (rawBody.length > 2_000_000) return new Response("Payload too large", { status: 413 });
        const providedSignature = request.headers.get("x-hub-signature-256") ?? "";
        if (!(await verifySignature(rawBody, providedSignature, appSecret))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: MetaWebhookPayload;
        try {
          payload = JSON.parse(rawBody) as MetaWebhookPayload;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          for (const entry of payload.entry ?? []) {
            for (const change of entry.changes ?? []) {
              const value = change.value;
              if (!value) continue;
              const nameByPhone = new Map(
                (value.contacts ?? []).map((contact) => [
                  contact.wa_id,
                  contact.profile?.name ?? null,
                ]),
              );

              for (const message of value.messages ?? []) {
                if (!message.from || !message.id) continue;
                const phone = message.from.startsWith("+") ? message.from : `+${message.from}`;
                const timestampSeconds = Number(message.timestamp);
                const timestampMillis = timestampSeconds * 1000;
                const receivedAt =
                  message.timestamp &&
                  Number.isFinite(timestampMillis) &&
                  Math.abs(timestampMillis) < 8.64e15
                    ? new Date(timestampMillis).toISOString()
                    : new Date().toISOString();
                const messageType = message.type ?? "unknown";
                const { body, attachmentMeta } = displayBody(message);
                const customerName = nameByPhone.get(message.from);
                const { data: duplicate, error: duplicateError } = await supabaseAdmin
                  .from("whatsapp_messages")
                  .select("id")
                  .eq("provider_message_id", message.id)
                  .maybeSingle();
                if (duplicateError) throw new Error(duplicateError.message);
                if (duplicate) continue;

                const { data: priorConversation, error: priorError } = await supabaseAdmin
                  .from("whatsapp_conversations")
                  .select("last_message_at, last_inbound_at")
                  .eq("customer_phone", phone)
                  .maybeSingle();
                if (priorError) throw new Error(priorError.message);
                const latestAt = new Date(
                  Math.max(
                    new Date(priorConversation?.last_message_at ?? 0).getTime(),
                    new Date(receivedAt).getTime(),
                  ),
                ).toISOString();
                const latestInboundAt = new Date(
                  Math.max(
                    new Date(priorConversation?.last_inbound_at ?? 0).getTime(),
                    new Date(receivedAt).getTime(),
                  ),
                ).toISOString();
                const { data: conversation, error: conversationError } = await supabaseAdmin
                  .from("whatsapp_conversations")
                  .upsert(
                    {
                      customer_phone: phone,
                      ...(customerName ? { customer_name: customerName } : {}),
                      last_inbound_at: latestInboundAt,
                      last_message_at: latestAt,
                      last_message_preview: body.slice(0, 240),
                      updated_at: new Date().toISOString(),
                    },
                    { onConflict: "customer_phone" },
                  )
                  .select("id")
                  .single();
                if (conversationError) throw new Error(conversationError.message);

                const { data: inserted, error: messageError } = await supabaseAdmin
                  .from("whatsapp_messages")
                  .upsert(
                    {
                      conversation_id: conversation.id,
                      direction: "inbound",
                      body,
                      message_type: messageType,
                      provider_message_id: message.id,
                      status: "received",
                      attachment_meta: attachmentMeta as never,
                      created_at: receivedAt,
                    },
                    { onConflict: "provider_message_id", ignoreDuplicates: true },
                  )
                  .select("id")
                  .maybeSingle();
                if (messageError) throw new Error(messageError.message);
                if (inserted) {
                  const { error: unreadError } = await supabaseAdmin.rpc(
                    "increment_whatsapp_unread",
                    {
                      _conversation_id: conversation.id,
                    },
                  );
                  if (unreadError) throw new Error(unreadError.message);
                }
              }

              for (const status of value.statuses ?? []) {
                if (!status.id || !status.status) continue;
                const allowedStatus = ["sent", "delivered", "read", "failed"].includes(
                  status.status,
                )
                  ? status.status
                  : null;
                if (!allowedStatus) continue;
                const details = status.errors
                  ?.map((item) => item.title ?? item.message)
                  .filter(Boolean)
                  .join("; ");
                const { data: storedMessage, error: storedError } = await supabaseAdmin
                  .from("whatsapp_messages")
                  .select("status")
                  .eq("provider_message_id", status.id)
                  .maybeSingle();
                if (storedError) throw new Error(storedError.message);
                if (!storedMessage || storedMessage.status === "failed") continue;
                const progression: Record<string, number> = {
                  received: 0,
                  sending: 1,
                  sent: 2,
                  delivered: 3,
                  read: 4,
                };
                if (
                  allowedStatus !== "failed" &&
                  progression[allowedStatus]! < (progression[storedMessage.status] ?? 0)
                )
                  continue;
                const { error } = await supabaseAdmin
                  .from("whatsapp_messages")
                  .update({ status: allowedStatus, error_message: details?.slice(0, 500) ?? null })
                  .eq("provider_message_id", status.id);
                if (error) throw new Error(error.message);
              }
            }
          }
        } catch (error) {
          console.error("WhatsApp webhook persistence failed", error);
          return Response.json({ received: false }, { status: 500 });
        }

        return Response.json({ received: true });
      },
    },
  },
});

async function verifySignature(rawBody: string, signature: string, secret: string) {
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  const expected = `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (signature.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.toLowerCase().charCodeAt(index);
  }
  return difference === 0;
}

type MetaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: Record<string, unknown> & { caption?: string };
  video?: Record<string, unknown> & { caption?: string };
  document?: Record<string, unknown> & { caption?: string; filename?: string };
  audio?: Record<string, unknown>;
  sticker?: Record<string, unknown>;
  location?: Record<string, unknown>;
  interactive?: Record<string, unknown>;
  button?: Record<string, unknown>;
};

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: MetaMessage[];
        statuses?: Array<{
          id?: string;
          status?: string;
          errors?: Array<{ title?: string; message?: string }>;
        }>;
      };
    }>;
  }>;
};

function displayBody(message: MetaMessage) {
  const type = message.type ?? "unknown";
  const typed = message[type as keyof MetaMessage] as Record<string, unknown> | undefined;
  const caption = typeof typed?.["caption"] === "string" ? typed["caption"] : null;
  const text = message.text?.body ?? caption;
  const labels: Record<string, string> = {
    image: "Image",
    video: "Video",
    document: "Document",
    audio: "Audio",
    sticker: "Sticker",
    location: "Location",
    interactive: "Interactive message",
    button: "Button response",
  };
  return {
    body: text || `[${labels[type] ?? `${type} message`} received]`,
    attachmentMeta: typed ?? {},
  };
}

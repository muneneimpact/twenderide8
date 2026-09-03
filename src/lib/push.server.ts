/** Server-only web push delivery through the Firebase Cloud Messaging gateway. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/firebase_messaging";

export interface PushInput {
  userId: string;
  title: string;
  body: string;
  /** In-app destination opened when the notification is clicked. */
  path?: string;
  dedupeKey?: string;
  templateCode?: string;
  rideId?: string | null;
}

export interface PushResult {
  delivered: number;
  removed: number;
  skipped?: string;
}

/**
 * Sends one alert to every device the person registered. Data-only messages are
 * used so the service worker owns how the notification looks and where a click
 * lands. Invalid or expired tokens are deleted rather than retried, and a
 * delivery problem never throws into the caller's flow.
 */
export async function sendPush(input: PushInput): Promise<PushResult> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["FIREBASE_MESSAGING_API_KEY"];
  if (!lovableKey || !connectionKey) return { delivered: 0, removed: 0, skipped: "not_configured" };

  const { data: prefs } = await supabaseAdmin
    .from("notification_preferences")
    .select("push_enabled")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (prefs?.push_enabled === false) return { delivered: 0, removed: 0, skipped: "disabled" };

  const { data: tokens } = await supabaseAdmin
    .from("push_tokens")
    .select("id, token")
    .eq("user_id", input.userId);
  if (!tokens || tokens.length === 0) return { delivered: 0, removed: 0, skipped: "no_tokens" };

  const headers = {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectionKey,
    "Content-Type": "application/json",
  };

  let delivered = 0;
  const stale: string[] = [];

  for (const row of tokens) {
    try {
      const response = await fetch(`${GATEWAY_URL}/v1/projects/_/messages:send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: {
            token: row.token,
            data: {
              title: input.title,
              body: input.body,
              path: input.path ?? "/",
              dedupeKey: input.dedupeKey ?? "",
              templateCode: input.templateCode ?? "",
              rideId: input.rideId ?? "",
            },
            webpush: { headers: { Urgency: "high", TTL: "600" } },
          },
        }),
      });

      if (response.ok) {
        delivered += 1;
        continue;
      }

      const errorBody = await response.text();
      console.error(`FCM send failed [${response.status}]: ${errorBody}`);
      const unregistered =
        response.status === 404 ||
        (response.status === 400 && errorBody.includes("INVALID_ARGUMENT")) ||
        errorBody.includes("UNREGISTERED");
      if (unregistered) stale.push(row.token);
    } catch (error) {
      console.error("push send error", error);
    }
  }

  if (stale.length) {
    await supabaseAdmin.from("push_tokens").delete().in("token", stale);
  }

  return { delivered, removed: stale.length };
}

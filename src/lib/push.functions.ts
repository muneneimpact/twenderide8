import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Stores (or refreshes) a device push registration for the signed-in person.
 * The same token is re-pointed at whoever is signed in on that device, so a
 * shared phone never delivers the previous person's alerts.
 */
export const registerPushToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(20).max(4096),
        userAgent: z.string().max(400).optional(),
        deviceLabel: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("push_tokens").upsert(
      {
        user_id: context.userId,
        token: data.token,
        user_agent: data.userAgent ?? null,
        device_label: data.deviceLabel ?? null,
        platform: "web",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (error) throw new Error(error.message);

    await context.supabase.from("notification_preferences").upsert(
      { user_id: context.userId, push_enabled: true, push_permission: "granted" },
      { onConflict: "user_id" },
    );
    return { ok: true };
  });

/** Removes a device registration (sign-out, or the user turning push off). */
export const removePushToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ token: z.string().min(10).max(4096) }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("push_tokens")
      .delete()
      .eq("token", data.token)
      .eq("user_id", context.userId);
    return { ok: true };
  });

/** Sends a test alert to the signed-in person's own devices. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendPush } = await import("./push.server");
    const result = await sendPush({
      userId: context.userId,
      title: "Twende Meru Rides",
      body: "Push notifications are working on this device.",
      path: "/account",
      dedupeKey: `test:${context.userId}:${Date.now()}`,
    });
    return result;
  });

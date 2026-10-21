import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * In-ride chat. Row level security already restricts every read and write to
 * the customer, the assigned driver and Twende staff, so these functions only
 * need to shape the data the screens render.
 */
export const listRideMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("ride_messages")
      .select("id, ride_id, sender_id, sender_role, body, created_at")
      .eq("ride_id", data.rideId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    // Names come through the privileged client because profiles RLS only
    // exposes a user's own row; both chat parties may see each other's name.
    const senderIds = [...new Set((rows ?? []).map((row) => row.sender_id))];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = senderIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", senderIds)
      : { data: [] as Array<{ id: string; full_name: string | null }> };
    const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    return {
      me: context.userId,
      messages: (rows ?? []).map((row) => ({
        id: row.id,
        body: row.body,
        senderId: row.sender_id,
        senderRole: row.sender_role as "customer" | "driver" | "ops",
        senderName: names.get(row.sender_id) ?? null,
        createdAt: row.created_at,
        mine: row.sender_id === context.userId,
      })),
    };
  });

export const sendRideMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rideId: z.string().uuid(), body: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id, customer_id, driver_id, status")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride) throw new Error("That ride no longer exists.");

    const role =
      ride.customer_id === context.userId ? "customer" : ride.driver_id === context.userId ? "driver" : "ops";

    const { error } = await context.supabase.from("ride_messages").insert({
      ride_id: data.rideId,
      sender_id: context.userId,
      sender_role: role,
      body: data.body.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

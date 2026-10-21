/** Ride ratings: driver averages for riders, full comments for staff. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getRideDriverRating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ rideId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("can_view_ride", { _user_id: context.userId, _ride_id: data.rideId });
    if (!ok) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin.from("rides").select("driver_id").eq("id", data.rideId).maybeSingle();
    if (!ride?.driver_id) return null;
    const [{ data: d }, { count }, { data: mine }] = await Promise.all([
      supabaseAdmin.from("drivers").select("rating, completed_rides").eq("id", ride.driver_id).maybeSingle(),
      supabaseAdmin.from("ratings").select("id", { count: "exact", head: true }).eq("ratee_id", ride.driver_id),
      supabaseAdmin.from("ratings").select("score, comment").eq("ride_id", data.rideId).eq("rater_id", context.userId).maybeSingle(),
    ]);
    return { average: Number(d?.rating ?? 0), reviews: count ?? 0, trips: d?.completed_rides ?? 0, mine: mine ?? null };
  });

export const listRatingsForStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ onlyWithComments: z.boolean().default(false) }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!staff) throw new Error("Staff only.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("ratings").select("id, ride_id, rater_id, ratee_id, score, comment, created_at").order("created_at", { ascending: false }).limit(200);
    if (data.onlyWithComments) q = q.not("comment", "is", null);
    const { data: rows } = await q;
    const list = rows ?? [];
    const ids = Array.from(new Set(list.flatMap((r) => [r.rater_id, r.ratee_id])));
    const rideIds = Array.from(new Set(list.map((r) => r.ride_id)));
    const [{ data: people }, { data: rides }, { data: drivers }] = await Promise.all([
      ids.length ? supabaseAdmin.from("profiles").select("id, full_name").in("id", ids) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      rideIds.length ? supabaseAdmin.from("rides").select("id, reference, driver_id").in("id", rideIds) : Promise.resolve({ data: [] as { id: string; reference: string; driver_id: string | null }[] }),
      ids.length ? supabaseAdmin.from("drivers").select("id, rating").in("id", ids) : Promise.resolve({ data: [] as { id: string; rating: number }[] }),
    ]);
    const name = new Map((people ?? []).map((p) => [p.id, p.full_name ?? "—"]));
    const ride = new Map((rides ?? []).map((r) => [r.id, r]));
    const avg = new Map((drivers ?? []).map((d) => [d.id, Number(d.rating)]));
    return list.map((r) => {
      const rr = ride.get(r.ride_id);
      const aboutDriver = rr?.driver_id === r.ratee_id;
      return {
        id: r.id, score: r.score, comment: r.comment, created_at: r.created_at,
        trip: rr?.reference ?? "—", about: aboutDriver ? "driver" : "customer",
        rater: name.get(r.rater_id) ?? "—", ratee: name.get(r.ratee_id) ?? "—",
        driverAverage: aboutDriver ? (avg.get(r.ratee_id) ?? null) : null,
      };
    });
  });

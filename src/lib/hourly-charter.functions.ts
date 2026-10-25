import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function nairobiDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export const submitHourlyCharterRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    vehicleId: z.string().uuid(),
    startAt: z.string().min(10).max(40),
    durationHours: z.number().int().min(1).max(24),
    passengers: z.number().int().min(1).max(12),
    pickupLabel: z.string().trim().min(2).max(200),
    itinerary: z.string().trim().min(2).max(1200),
    notes: z.string().trim().max(1000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const start = new Date(data.startAt);
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() + 10 * 60_000)
      throw new Error("Choose a pickup time at least 10 minutes from now.");
    const end = new Date(start.getTime() + data.durationHours * 60 * 60_000);
    const { data: vehicle } = await supabaseAdmin.from("vehicles")
      .select("id, vehicle_class, hire_mode, hire_hourly_available, hire_available, hire_approval_status, status")
      .eq("id", data.vehicleId).maybeSingle();
    if (!vehicle || !vehicle.hire_hourly_available || !vehicle.hire_available || vehicle.status !== "approved" || vehicle.hire_approval_status !== "approved")
      throw new Error("That car is not accepting hourly charter requests right now.");
    if (vehicle.hire_mode === "self_drive") throw new Error("Hourly charter requires a chauffeured car.");
    const { data: blackouts } = await supabaseAdmin.from("hire_vehicle_blackouts").select("id")
      .eq("vehicle_id", data.vehicleId).lte("start_date", nairobiDateKey(end)).gte("end_date", nairobiDateKey(start)).limit(1);
    if (blackouts?.length) throw new Error("The car is unavailable at that time. Choose another time or car.");
    const { data: bookings } = await supabaseAdmin.from("hire_quotes")
      .select("id, start_at, end_at, days, payment_status, payment_hold_expires_at, pay_later_method, status, service_type")
      .eq("vehicle_id", data.vehicleId).in("status", ["submitted", "quoted", "confirmed"]);
    const busy = (bookings ?? []).some((booking) => {
      if (booking.service_type === "hourly_charter" && ["submitted", "quoted"].includes(booking.status) && booking.payment_status === "unpaid") return false;
      const blocking = !["unpaid", "pending", "failed", "cancelled", "timed_out"].includes(booking.payment_status) || Boolean(booking.payment_hold_expires_at && new Date(booking.payment_hold_expires_at).getTime() > Date.now()) || (booking.status === "confirmed" && Boolean(booking.pay_later_method));
      const busyEnd = booking.end_at ? new Date(booking.end_at).getTime() : new Date(booking.start_at).getTime() + booking.days * 86_400_000;
      return blocking && new Date(booking.start_at).getTime() < end.getTime() && busyEnd > start.getTime();
    });
    if (busy) throw new Error("That car already has a confirmed booking or active payment hold for those hours.");
    const { data: profile } = await supabaseAdmin.from("profiles").select("full_name, phone").eq("id", context.userId).maybeSingle();
    const { data: row, error } = await supabaseAdmin.from("hire_quotes").insert({
      requester_id: context.userId, kind: "car_hire", vehicle_id: data.vehicleId,
      vehicle_class: vehicle.vehicle_class, drive_mode: "chauffeured", start_at: start.toISOString(),
      end_at: end.toISOString(), days: 1, duration_hours: data.durationHours,
      service_type: "hourly_charter", passengers: data.passengers, pickup_label: data.pickupLabel,
      stops: [{ label: data.itinerary }], notes: data.notes ?? null, estimated_total: 0,
      quoted_total: null, payment_policy: "legacy", payment_status: "unpaid", payment_paid_total: 0,
      status: "submitted", contact_name: profile?.full_name ?? null, contact_phone: profile?.phone ?? null,
      hirer_type: "individual", deposit_policy: "none", deposit_amount: 0,
    } as never).select("id, reference").single();
    if (error || !row) throw new Error(error?.message ?? "Could not submit hourly charter request.");
    try {
      const { notify } = await import("@/lib/notifications.server");
      const { data: owner } = await supabaseAdmin.from("vehicles").select("owner_driver_id").eq("id", data.vehicleId).maybeSingle();
      if (owner?.owner_driver_id) await notify({ userId: owner.owner_driver_id, templateCode: "hire_quote_submitted", title: "Hourly charter request", body: `${row.reference}: ${data.durationHours} hour(s), pickup ${start.toLocaleString("en-KE")}. Open Hire requests to send your offer.`, dedupeKey: `hourly-charter:${row.id}`, critical: true });
    } catch (error) { console.error("hourly charter notification failed", error); }
    return { id: row.id, reference: row.reference };
  });

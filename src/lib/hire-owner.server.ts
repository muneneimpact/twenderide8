import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Vehicle ids the user owns directly or through a fleet they own. */
export async function ownedVehicleIds(userId: string): Promise<string[]> {
  const { data: fleets } = await supabaseAdmin.from("fleets").select("id").eq("owner_id", userId);
  const fleetIds = (fleets ?? []).map((f) => f.id);
  const filter = fleetIds.length
    ? `owner_driver_id.eq.${userId},fleet_id.in.(${fleetIds.join(",")})`
    : `owner_driver_id.eq.${userId}`;
  const { data } = await supabaseAdmin.from("vehicles").select("id").or(filter);
  return (data ?? []).map((v) => v.id);
}

/** SMS + push the owner (and assigned driver) as soon as a booking is secured. */
export async function notifyOwnerOfBooking(quoteId: string, detail: string) {
  const { data: q } = await supabaseAdmin
    .from("hire_quotes")
    .select("id, reference, vehicle_id, assigned_driver_id, start_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (!q?.vehicle_id) return;
  const { data: v } = await supabaseAdmin
    .from("vehicles")
    .select("owner_driver_id, fleet_id, plate_number")
    .eq("id", q.vehicle_id)
    .maybeSingle();
  let ownerId = v?.owner_driver_id ?? null;
  if (!ownerId && v?.fleet_id) {
    const { data: f } = await supabaseAdmin.from("fleets").select("owner_id").eq("id", v.fleet_id).maybeSingle();
    ownerId = f?.owner_id ?? null;
  }
  const recipients = [...new Set([ownerId, q.assigned_driver_id].filter((x): x is string => Boolean(x)))];
  const text = `Twende Meru: new hire ${q.reference} for ${v?.plate_number ?? "your car"} from ${new Date(q.start_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })} (${detail}). Act now: https://twenderide8.lovable.app/driver/hire?section=bookings`;
  const { notify } = await import("./notifications.server");
  const { sendTransactionalSms } = await import("./comms.server");
  for (const userId of recipients) {
    await notify({
      userId,
      templateCode: "hire_booking_new",
      title: "New hire booking",
      body: text,
      critical: true,
      dedupeKey: `hire-new:${q.id}:${userId}`,
    }).catch(() => undefined);
    const { data: p } = await supabaseAdmin.from("profiles").select("phone").eq("id", userId).maybeSingle();
    if (p?.phone) {
      await sendTransactionalSms({
        to: p.phone,
        message: text,
        eventType: "hire_owner_new_sms",
        idempotencyKey: `hire-new-sms:${q.id}:${userId}`,
        context: { userId },
      }).catch(() => undefined);
    }
  }
}

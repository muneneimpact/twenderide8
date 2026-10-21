/**
 * Server-only SMS for events that previously stayed in-app only:
 * document rejection / expiry, complaint resolution, delivery recipients.
 * Never throws — a message problem must not break the action that caused it.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appLink, textUserWithLink } from "./links.server";

type DocRow = {
  id: string;
  subject_user_id: string | null;
  subject_vehicle_id: string | null;
  subject_fleet_id: string | null;
  expires_on: string | null;
  expiry_reminders_sent: string[] | null;
  document_types: { label: string } | null;
  vehicles: { plate_number: string; owner_driver_id: string | null; fleet_id: string | null } | null;
};

const DOC_SELECT =
  "id, subject_user_id, subject_vehicle_id, subject_fleet_id, expires_on, expiry_reminders_sent, document_types(label), vehicles:subject_vehicle_id(plate_number, owner_driver_id, fleet_id)";

async function docOwner(d: DocRow): Promise<string | null> {
  if (d.subject_user_id) return d.subject_user_id;
  if (d.vehicles?.owner_driver_id) return d.vehicles.owner_driver_id;
  const fleetId = d.subject_fleet_id ?? d.vehicles?.fleet_id ?? null;
  if (!fleetId) return null;
  const { data } = await supabaseAdmin.from("fleets").select("owner_id").eq("id", fleetId).maybeSingle();
  return data?.owner_id ?? null;
}

function docName(d: DocRow) {
  const label = d.document_types?.label ?? "document";
  return d.vehicles?.plate_number ? `${label} for ${d.vehicles.plate_number}` : label;
}

export async function smsDocumentRejected(docId: string, reason: string) {
  try {
    const { data } = await supabaseAdmin.from("documents").select(DOC_SELECT).eq("id", docId).maybeSingle();
    const d = data as unknown as DocRow | null;
    if (!d) return;
    const owner = await docOwner(d);
    if (!owner) return;
    await textUserWithLink({
      userId: owner,
      message: `Twende: your ${docName(d)} was not accepted. Reason: ${reason.slice(0, 120)}. Please upload a new one:`,
      path: "/driver/apply",
      eventType: "document_rejected",
      idempotencyKey: `doc-rejected:${docId}:${Date.now()}`,
    });
  } catch (e) {
    console.error("document rejected sms failed", e);
  }
}

const REMINDER_DAYS = [14, 3, 0] as const;

/** Daily: text owners whose approved documents expire in 14 or 3 days, or today. Each reminder goes once. */
export async function sendDocumentExpiryReminders() {
  const today = new Date();
  const iso = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("documents")
    .select(DOC_SELECT)
    .eq("status", "approved")
    .gte("expires_on", iso(0))
    .lte("expires_on", iso(14));
  let sent = 0;
  for (const raw of data ?? []) {
    const d = raw as unknown as DocRow;
    if (!d.expires_on) continue;
    const daysLeft = Math.round((new Date(`${d.expires_on}T00:00:00Z`).getTime() - new Date(`${iso(0)}T00:00:00Z`).getTime()) / 86_400_000);
    const stage = REMINDER_DAYS.find((n) => daysLeft <= n && !(d.expiry_reminders_sent ?? []).includes(`${n}:${d.expires_on}`));
    if (stage === undefined) continue;
    // Only the most urgent unsent stage; skip earlier stages that no longer apply.
    const tag = `${stage}:${d.expires_on}`;
    const owner = await docOwner(d);
    if (owner) {
      const when = daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${d.expires_on})`;
      await textUserWithLink({
        userId: owner,
        message: `Twende: your ${docName(d)} expires ${when}. Upload the renewed one so you can keep going online:`,
        path: "/driver/apply",
        eventType: "document_expiry_reminder",
        idempotencyKey: `doc-expiry:${d.id}:${tag}`,
      });
      sent += 1;
    }
    await supabaseAdmin
      .from("documents")
      .update({ expiry_reminders_sent: [...(d.expiry_reminders_sent ?? []), tag] })
      .eq("id", d.id);
  }
  return { checked: data?.length ?? 0, sent };
}

export async function smsComplaintResolved(caseId: string) {
  try {
    const { data: c } = await supabaseAdmin.from("support_cases").select("id, customer_id, subject").eq("id", caseId).maybeSingle();
    if (!c) return;
    await textUserWithLink({
      userId: c.customer_id,
      message: `Twende: your complaint "${c.subject.slice(0, 60)}" has been resolved. See the reply or reopen it here:`,
      path: "/account",
      eventType: "support_case_resolved",
      idempotencyKey: `case-resolved:${caseId}:${Date.now()}`,
    });
  } catch (e) {
    console.error("complaint resolved sms failed", e);
  }
}

/** Text the person receiving a package when it is picked up and when it is delivered. */
export async function smsDeliveryRecipient(rideId: string, stage: "picked_up" | "delivered") {
  try {
    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id, reference, quote_id, driver_id, vehicle_id, customer_id")
      .eq("id", rideId)
      .maybeSingle();
    if (!ride?.quote_id) return;
    const { data: q } = await supabaseAdmin
      .from("route_quotes")
      .select("trip_kind, recipient_name, recipient_phone, dropoff_address")
      .eq("id", ride.quote_id)
      .maybeSingle();
    if (!q || q.trip_kind !== "delivery" || !q.recipient_phone) return;
    const [{ data: sender }, { data: driver }, { data: vehicle }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name").eq("id", ride.customer_id).maybeSingle(),
      ride.driver_id ? supabaseAdmin.from("profiles").select("full_name, phone").eq("id", ride.driver_id).maybeSingle() : Promise.resolve({ data: null }),
      ride.vehicle_id ? supabaseAdmin.from("vehicles").select("plate_number").eq("id", ride.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const hi = q.recipient_name ? `Hi ${q.recipient_name}, ` : "";
    const from = sender?.full_name ?? "someone";
    const message =
      stage === "picked_up"
        ? `Twende: ${hi}a package from ${from} is on the way to ${q.dropoff_address ?? "you"}. Rider ${driver?.full_name ?? ""}${vehicle?.plate_number ? ` (${vehicle.plate_number})` : ""}${driver?.phone ? `, ${driver.phone}` : ""}. Ref ${ride.reference}.`
        : `Twende: ${hi}your package from ${from} (ref ${ride.reference}) has been delivered. Questions? ${appLink("/")}`;
    const { sendTransactionalSms } = await import("./comms.server");
    await sendTransactionalSms({
      to: q.recipient_phone,
      message,
      eventType: `delivery_recipient_${stage}`,
      idempotencyKey: `delivery-recipient:${ride.id}:${stage}`,
      context: { rideId: ride.id },
    });
  } catch (e) {
    console.error("delivery recipient sms failed", e);
  }
}

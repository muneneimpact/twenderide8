/**
 * Lost & found between customers and drivers, plus bringing a driver into a
 * complaint thread. Driver "found" reports may span several trips.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface TripOption {
  id: string;
  label: string;
  when: string;
}

export interface LostFoundView {
  id: string;
  kind: "lost" | "found";
  reporter_role: "customer" | "driver";
  reporter_name: string;
  description: string;
  status: string;
  trips: TripOption[];
  created_at: string;
}

async function tripLabels(ids: string[]): Promise<Map<string, TripOption>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!ids.length) return new Map();
  const { data: rides } = await supabaseAdmin
    .from("rides")
    .select("id, reference, quote_id, requested_at")
    .in("id", ids);
  const quoteIds = (rides ?? []).map((r) => r.quote_id).filter((v): v is string => Boolean(v));
  const { data: quotes } = quoteIds.length
    ? await supabaseAdmin.from("route_quotes").select("id, dropoff_address").in("id", quoteIds)
    : { data: [] as Array<{ id: string; dropoff_address: string | null }> };
  const q = new Map((quotes ?? []).map((x) => [x.id, x.dropoff_address]));
  return new Map(
    (rides ?? []).map((r) => [
      r.id,
      {
        id: r.id,
        label: (r.quote_id ? q.get(r.quote_id) : null) ?? r.reference,
        when: r.requested_at,
      },
    ]),
  );
}

/** Recent trips the caller took (customer) or drove (driver), for picking. */
export const listMyRecentTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ as: z.enum(["customer", "driver"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const col = data.as === "driver" ? "driver_id" : "customer_id";
    const { data: rides } = await supabaseAdmin
      .from("rides")
      .select("id")
      .eq(col, context.userId)
      .eq("status", "trip_completed")
      .order("requested_at", { ascending: false })
      .limit(20);
    const map = await tripLabels((rides ?? []).map((r) => r.id));
    return [...map.values()].sort((a, b) => b.when.localeCompare(a.when));
  });

export const createLostFoundReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        as: z.enum(["customer", "driver"]),
        rideIds: z.array(z.string().uuid()).min(1).max(10),
        description: z.string().trim().min(10).max(1000),
        photoDataUrl: z.string().max(7_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const col = data.as === "driver" ? "driver_id" : "customer_id";
    const { data: owned } = await supabaseAdmin
      .from("rides")
      .select("id")
      .in("id", data.rideIds)
      .eq("status", "trip_completed")
      .eq(col, context.userId);
    if ((owned ?? []).length !== data.rideIds.length) throw new Error("Pick only your own completed trips.");
    if (data.as === "customer" && data.rideIds.length > 1)
      throw new Error("Choose the single trip where the item was lost.");
    if (data.as === "customer" && data.photoDataUrl) throw new Error("Only the driver adds a photo.");
    const { data: report, error } = await context.supabase.from("lost_found_reports").insert({
      reporter_id: context.userId,
      reporter_role: data.as,
      kind: data.as === "driver" ? "found" : "lost",
      ride_ids: data.rideIds,
      description: data.description,
    }).select("id").single();
    if (error) throw new Error(error.message);
    if (data.as === "driver" && data.photoDataUrl) {
      // Private: only the finding driver and staff can open it. The passenger never sees it.
      const [meta, b64] = data.photoDataUrl.split(",");
      const type = meta!.slice(5, meta!.indexOf(";"));
      const bin = Uint8Array.from(atob(b64!), (ch) => ch.charCodeAt(0));
      const path = `lost-found/${report.id}.${type.split("/")[1]}`;
      const { error: upErr } = await supabaseAdmin.storage.from("driver-documents").upload(path, bin, { contentType: type, upsert: true });
      if (!upErr) await supabaseAdmin.from("lost_found_reports").update({ photo_path: path }).eq("id", report.id);
    }
    if (data.as === "driver") {
      // Tell each passenger on those trips — without revealing what was found.
      const { data: rides } = await supabaseAdmin.from("rides").select("id, customer_id").in("id", data.rideIds);
      const { notify } = await import("./notifications.server");
      const { textUserWithLink } = await import("./links.server");
      for (const r of rides ?? []) {
        if (!r.customer_id) continue;
        await notify({
          userId: r.customer_id,
          templateCode: "lost_found_driver_found",
          title: "Your driver found something",
          body: "Your driver found an item that may be yours. Describe it to claim it.",
          rideId: r.id,
        });
        await textUserWithLink({
          userId: r.customer_id,
          message: "Twende: your driver found an item that may be yours. Describe it to claim it:",
          path: "/lost-found",
          eventType: "lost_found_driver_found",
          idempotencyKey: `lf-found:${report.id}:${r.id}`,
        });
      }
    }
    return { ok: true };
  });

async function shape(rows: Array<{
  id: string; kind: string; reporter_role: string; reporter_id: string; description: string;
  status: string; ride_ids: string[]; created_at: string;
}>): Promise<LostFoundView[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const trips = await tripLabels([...new Set(rows.flatMap((r) => r.ride_ids))]);
  const { data: people } = rows.length
    ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", rows.map((r) => r.reporter_id))
    : { data: [] as Array<{ id: string; full_name: string | null }> };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as "lost" | "found",
    reporter_role: r.reporter_role as "customer" | "driver",
    reporter_name: names.get(r.reporter_id) ?? "Twende user",
    description: r.description,
    status: r.status,
    trips: r.ride_ids.map((id) => trips.get(id)).filter((t): t is TripOption => Boolean(t)),
    created_at: r.created_at,
  }));
}

/**
 * Own reports, plus — for drivers — customer "lost" reports on trips they
 * drove, so they can verify the description against what they found.
 */
export const listMyLostFound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: mine } = await supabaseAdmin
      .from("lost_found_reports")
      .select("*")
      .eq("reporter_id", context.userId)
      .order("created_at", { ascending: false });
    const { data: driven } = await supabaseAdmin
      .from("rides")
      .select("id")
      .eq("driver_id", context.userId)
      .order("requested_at", { ascending: false })
      .limit(50);
    const drivenIds = (driven ?? []).map((r) => r.id);
    const { data: toVerify } = drivenIds.length
      ? await supabaseAdmin
          .from("lost_found_reports")
          .select("*")
          .eq("kind", "lost")
          .eq("status", "open")
          .overlaps("ride_ids", drivenIds)
      : { data: [] };
    return { mine: await shape(mine ?? []), toVerify: await shape(toVerify ?? []) };
  });

export const listAllLostFound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("lost_found_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return shape(data ?? []);
  });

export const setLostFoundStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), status: z.enum(["open", "matched", "returned", "closed"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("lost_found_reports")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Staff bring the trip's driver into a complaint so they can respond. */
export const addDriverToCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin
      .from("support_cases")
      .select("id, ride_id")
      .eq("id", data.caseId)
      .maybeSingle();
    if (!c?.ride_id) throw new Error("This complaint is not linked to a trip with a driver.");
    const { data: ride } = await supabaseAdmin.from("rides").select("driver_id").eq("id", c.ride_id).maybeSingle();
    if (!ride?.driver_id) throw new Error("No driver was assigned to that trip.");
    await supabaseAdmin.from("support_cases").update({ involved_driver_id: ride.driver_id }).eq("id", c.id);
    await supabaseAdmin.from("support_messages").insert({
      case_id: c.id,
      sender_id: context.userId,
      sender_role: "agent",
      body: "The driver has been added to this conversation to help resolve the issue.",
    });
    return { ok: true };
  });

/** Complaints a driver has been brought into, with the thread. */
export const listDriverCases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cases } = await supabaseAdmin
      .from("support_cases")
      .select("id, subject, status, created_at")
      .eq("involved_driver_id", context.userId)
      .order("last_message_at", { ascending: false });
    const ids = (cases ?? []).map((c) => c.id);
    const { data: msgs } = ids.length
      ? await supabaseAdmin.from("support_messages").select("id, case_id, sender_role, body, created_at").in("case_id", ids).order("created_at")
      : { data: [] as Array<{ id: string; case_id: string; sender_role: string; body: string; created_at: string }> };
    return (cases ?? []).map((c) => ({ ...c, messages: (msgs ?? []).filter((m) => m.case_id === c.id) }));
  });

export const postDriverCaseMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ caseId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin
      .from("support_cases")
      .select("id")
      .eq("id", data.caseId)
      .eq("involved_driver_id", context.userId)
      .maybeSingle();
    if (!c) throw new Error("You have not been added to this complaint.");
    await supabaseAdmin.from("support_messages").insert({
      case_id: c.id,
      sender_id: context.userId,
      sender_role: "driver",
      body: data.body,
    });
    await supabaseAdmin.from("support_cases").update({ last_message_at: new Date().toISOString() }).eq("id", c.id);
    return { ok: true };
  });

/** Email the trip receipt to the customer's address (or one they type). */
export const emailRideReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rideId: z.string().uuid(), email: z.string().trim().email().optional(), pdfBase64: z.string().max(8_000_000).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id, reference, customer_id, driver_id, vehicle_id, quote_id, total_fare, payment_method, requested_at, completed_at")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride || ride.customer_id !== context.userId) throw new Error("Trip not found.");
    const [{ data: me }, { data: quote }, { data: driver }, { data: vehicle }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name, email").eq("id", context.userId).maybeSingle(),
      ride.quote_id
        ? supabaseAdmin.from("route_quotes").select("pickup_address, dropoff_address, distance_km").eq("id", ride.quote_id).maybeSingle()
        : Promise.resolve({ data: null }),
      ride.driver_id
        ? supabaseAdmin.from("profiles").select("full_name").eq("id", ride.driver_id).maybeSingle()
        : Promise.resolve({ data: null }),
      ride.vehicle_id
        ? supabaseAdmin.from("vehicles").select("make, model, plate_number").eq("id", ride.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const to = data.email ?? me?.email;
    if (!to) throw new Error("Add an email address to receive the receipt.");
    const q = quote as { pickup_address?: string | null; dropoff_address?: string | null; distance_km?: number | null } | null;
    const v = vehicle as { make?: string | null; model?: string | null; plate_number?: string | null } | null;
    const { sendTransactionalEmail } = await import("./comms.server");
    const result = await sendTransactionalEmail({
      to,
      template: {
        code: "trip_receipt",
        data: {
          customerName: me?.full_name ?? "Customer",
          reference: ride.reference,
          when: new Date(ride.completed_at ?? ride.requested_at).toLocaleString("en-KE"),
          pickup: q?.pickup_address ?? "—",
          dropoff: q?.dropoff_address ?? "—",
          distanceKm: Number(q?.distance_km ?? 0),
          fare: `KES ${Number(ride.total_fare ?? 0).toFixed(2)}`,
          paymentMethod: ride.payment_method === "cash" ? "Cash" : "M-Pesa",
          driverName: (driver as { full_name?: string | null } | null)?.full_name ?? null,
          vehicle: v ? [v.make, v.model].filter(Boolean).join(" ") : null,
          plate: v?.plate_number ?? null,
        },
      },
      eventType: "trip_receipt_manual",
      idempotencyKey: `receipt:${ride.id}:${to}:${Date.now()}`,
      context: { userId: context.userId, rideId: ride.id },
      attachments: data.pdfBase64 ? [{ filename: `Twende-receipt-${ride.reference}.pdf`, content: data.pdfBase64 }] : undefined,
    });
    if (!result.sent) throw new Error(result.detail ?? "Email could not be sent.");
    return { to };
  });


/** Driver "found" reports on the caller's trips. The driver's description is never returned. */
export const listFoundForMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rides } = await supabaseAdmin
      .from("rides").select("id").eq("customer_id", context.userId).eq("status", "trip_completed")
      .order("requested_at", { ascending: false }).limit(50);
    const rideIds = (rides ?? []).map((r) => r.id);
    if (!rideIds.length) return [];
    const { data: reports } = await supabaseAdmin
      .from("lost_found_reports").select("id, ride_ids, status, created_at, reporter_id")
      .eq("kind", "found").in("status", ["open", "matched"]).overlaps("ride_ids", rideIds);
    // Never the driver's description or photo — the claim stays blind.
    const { data: claimRows } = (reports ?? []).length
      ? await supabaseAdmin.from("lost_found_claims").select("report_id, status, driver_note, handover_request, dropoff_note, phone_shared_at")
          .eq("claimant_id", context.userId).in("report_id", (reports ?? []).map((r) => r.id))
      : { data: [] };
    const sharedIds = (reports ?? []).filter((r) => (claimRows ?? []).some((c) => c.report_id === r.id && c.phone_shared_at && c.status === "approved"));
    const driverIds = [...new Set(sharedIds.map((r) => r.reporter_id))];
    const { data: phones } = driverIds.length ? await supabaseAdmin.from("profiles").select("id, phone").in("id", driverIds) : { data: [] as { id: string; phone: string | null }[] };
    const mine = new Set(rideIds);
    const labels = await tripLabels(rideIds);
    return (reports ?? []).map((r) => {
      const rideId = r.ride_ids.find((id) => mine.has(id))!;
      const c = (claimRows ?? []).find((x) => x.report_id === r.id) ?? null;
      const claim = c ? {
        status: c.status, driver_note: c.driver_note, handover_request: c.handover_request, dropoff_note: c.dropoff_note,
        driver_phone: c.phone_shared_at && c.status === "approved" ? ((phones ?? []).find((p) => p.id === r.reporter_id)?.phone ?? null) : null,
      } : null;
      return { id: r.id, ride_id: rideId, trip: labels.get(rideId) ?? null, found_at: r.created_at, claim };
    });
  });

export const submitFoundClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      reportId: z.string().uuid(),
      rideId: z.string().uuid(),
      description: z.string().trim().min(10).max(1000),
      contactPhone: z.string().trim().max(20).optional(),
      securityDetails: z.string().trim().max(600).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin.from("rides").select("id")
      .eq("id", data.rideId).eq("customer_id", context.userId).eq("status", "trip_completed").maybeSingle();
    const { data: report } = await supabaseAdmin.from("lost_found_reports").select("id, reporter_id, ride_ids, kind")
      .eq("id", data.reportId).maybeSingle();
    if (!ride || !report || report.kind !== "found" || !report.ride_ids.includes(data.rideId)) {
      throw new Error("This found item is not linked to your trip.");
    }
    if (data.securityDetails && /\b(pin|password|passcode)\b\s*[:=]?\s*\d{4,}/i.test(data.securityDetails)) {
      throw new Error("Never send your lock-screen PIN or password. You unlock the phone in person at handover.");
    }
    const { error } = await supabaseAdmin.from("lost_found_claims").upsert({
      report_id: data.reportId, claimant_id: context.userId, ride_id: data.rideId,
      description: data.description, contact_phone: data.contactPhone ?? null,
      security_details: data.securityDetails ?? null, status: "pending", updated_at: new Date().toISOString(),
    }, { onConflict: "report_id,claimant_id" });
    if (error) throw new Error(error.message);
    const { notify } = await import("./notifications.server");
    await notify({ userId: report.reporter_id, templateCode: "lost_found_claim", title: "Someone claimed an item you found",
      body: "Check their description against the item.", rideId: data.rideId });
    const { textUserWithLink } = await import("./links.server");
    await textUserWithLink({ userId: report.reporter_id, message: "Twende: a passenger claimed an item you found. Check their description:",
      path: "/lost-found", eventType: "lost_found_claim", idempotencyKey: `lf-claim:${data.reportId}:${context.userId}:${Date.now()}` });
    return { ok: true };
  });

/** Claims on items the driver found, for them to match. */
export const listClaimsOnMyFinds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reports } = await supabaseAdmin.from("lost_found_reports").select("id, description, photo_path")
      .eq("reporter_id", context.userId).eq("kind", "found");
    if (!(reports ?? []).length) return [];
    const { data: claims } = await supabaseAdmin.from("lost_found_claims").select("*")
      .in("report_id", (reports ?? []).map((r) => r.id)).order("created_at", { ascending: false });
    const ids = [...new Set((claims ?? []).map((c) => c.claimant_id))];
    const { data: people } = ids.length ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    const labels = await tripLabels((claims ?? []).map((c) => c.ride_id));
    const paths = (reports ?? []).map((r) => r.photo_path).filter((p): p is string => Boolean(p));
    const signed = paths.length ? (await supabaseAdmin.storage.from("driver-documents").createSignedUrls(paths, 1800)).data ?? [] : [];
    const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]));
    return (claims ?? []).map((c) => {
      const rep = (reports ?? []).find((r) => r.id === c.report_id);
      return {
        id: c.id, status: c.status, description: c.description, contact_phone: c.contact_phone,
        security_details: c.security_details, driver_note: c.driver_note, created_at: c.created_at,
        claimant: (people ?? []).find((p) => p.id === c.claimant_id)?.full_name ?? "Passenger",
        trip: labels.get(c.ride_id)?.label ?? null,
        your_item: rep?.description ?? "",
        your_photo: rep?.photo_path ? (urlFor.get(rep.photo_path) ?? null) : null,
        handover_request: c.handover_request, dropoff_note: c.dropoff_note, phone_shared: Boolean(c.phone_shared_at),
      };
    });
  });

/**
 * The finding driver judges a claim. "approved" here means "this almost
 * matches — ask the passenger to confirm"; the claim waits for the customer.
 */
export const decideFoundClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ claimId: z.string().uuid(), decision: z.enum(["approved", "rejected", "more_info"]), note: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: claim } = await supabaseAdmin.from("lost_found_claims").select("id, report_id, claimant_id, ride_id").eq("id", data.claimId).maybeSingle();
    if (!claim) throw new Error("Claim not found.");
    const { data: report } = await supabaseAdmin.from("lost_found_reports").select("reporter_id").eq("id", claim.report_id).maybeSingle();
    if (report?.reporter_id !== context.userId) throw new Error("Only the driver who found the item can decide.");
    const status = data.decision === "approved" ? "awaiting_customer" : data.decision;
    await supabaseAdmin.from("lost_found_claims").update({ status, driver_note: data.note ?? null, updated_at: new Date().toISOString() }).eq("id", claim.id);
    const msg = data.decision === "approved"
      ? "Your driver thinks the item matches your description. Open Lost & found to confirm it is yours."
      : data.decision === "more_info" ? "Your driver needs more details to confirm the item." : "Your driver could not match your description to the item.";
    await tellUser(claim.claimant_id, claim.ride_id, msg, `lf-dec:${claim.id}:${status}`);
    return { ok: true };
  });

async function tellUser(userId: string, rideId: string | null, msg: string, key: string) {
  const { notify } = await import("./notifications.server");
  await notify({ userId, templateCode: "lost_found_update", title: "Lost & found update", body: msg, rideId: rideId ?? null });
  const { textUserWithLink } = await import("./links.server");
  await textUserWithLink({ userId, message: `Twende: ${msg}`, path: "/lost-found", eventType: "lost_found_update", idempotencyKey: `${key}:${Date.now()}` });
}

async function claimForDriver(claimId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: claim } = await supabaseAdmin.from("lost_found_claims").select("*").eq("id", claimId).maybeSingle();
  if (!claim) throw new Error("Claim not found.");
  const { data: report } = await supabaseAdmin.from("lost_found_reports").select("reporter_id").eq("id", claim.report_id).maybeSingle();
  if (report?.reporter_id !== userId) throw new Error("Only the driver who found the item can do this.");
  return { claim, db: supabaseAdmin };
}

/** Passenger confirms the item the driver matched is theirs. */
export const confirmFoundClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid(), confirm: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: claim } = await supabaseAdmin.from("lost_found_claims").select("id, report_id, ride_id, status")
      .eq("report_id", data.reportId).eq("claimant_id", context.userId).maybeSingle();
    if (!claim || claim.status !== "awaiting_customer") throw new Error("Nothing to confirm yet.");
    const now = new Date().toISOString();
    await supabaseAdmin.from("lost_found_claims").update({
      status: data.confirm ? "approved" : "rejected", customer_confirmed_at: data.confirm ? now : null, updated_at: now,
    }).eq("id", claim.id);
    const { data: report } = await supabaseAdmin.from("lost_found_reports").select("reporter_id").eq("id", claim.report_id).maybeSingle();
    if (data.confirm) await supabaseAdmin.from("lost_found_reports").update({ status: "matched", updated_at: now }).eq("id", claim.report_id);
    if (report) await tellUser(report.reporter_id, claim.ride_id,
      data.confirm ? "The passenger confirmed the item is theirs. Wait for their handover request." : "The passenger says the item is not theirs.",
      `lf-conf:${claim.id}`);
    return { ok: true };
  });

/** After confirmation the passenger asks for a drop-off, or for the driver's number. */
export const requestFoundHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid(), kind: z.enum(["dropoff", "phone"]), note: z.string().trim().max(300).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: claim } = await supabaseAdmin.from("lost_found_claims").select("id, report_id, ride_id, status")
      .eq("report_id", data.reportId).eq("claimant_id", context.userId).maybeSingle();
    if (!claim || claim.status !== "approved") throw new Error("Confirm the item first.");
    if (data.kind === "dropoff" && (!data.note || data.note.length < 4)) throw new Error("Say where the driver should drop it.");
    await supabaseAdmin.from("lost_found_claims").update({
      handover_request: data.kind, ...(data.kind === "dropoff" ? { dropoff_note: data.note ?? null } : {}), updated_at: new Date().toISOString(),
    }).eq("id", claim.id);
    const { data: report } = await supabaseAdmin.from("lost_found_reports").select("reporter_id").eq("id", claim.report_id).maybeSingle();
    if (report) await tellUser(report.reporter_id, claim.ride_id,
      data.kind === "dropoff" ? `The passenger asks you to drop the item at: ${data.note}` : "The passenger asks for your phone number to arrange collection. Allow it in Lost & found.",
      `lf-ho:${claim.id}:${data.kind}`);
    return { ok: true };
  });

/** Only the driver can reveal their phone number to the confirmed owner. */
export const shareDriverPhoneForClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ claimId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { claim, db } = await claimForDriver(data.claimId, context.userId);
    if (claim.status !== "approved") throw new Error("The passenger must confirm the item first.");
    await db.from("lost_found_claims").update({ phone_shared_at: new Date().toISOString() }).eq("id", claim.id);
    await tellUser(claim.claimant_id, claim.ride_id, "Your driver shared their phone number. Open Lost & found to call them.", `lf-phone:${claim.id}`);
    return { ok: true };
  });

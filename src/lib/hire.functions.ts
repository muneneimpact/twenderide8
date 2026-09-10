/**
 * Corporate bookings and car hire.
 *
 * A company (or anyone signed in) asks for a vehicle for one or more future
 * days, lists the places they want to visit, and receives an instant estimate.
 * The estimate is never the final word: the ops team reviews the request and
 * confirms or adjusts the price before it is accepted.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const VEHICLE_CLASSES = ["go", "plus", "comfort", "xl", "boda", "e_boda"] as const;

const stopSchema = z.object({
  label: z.string().min(2).max(160),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

/** Indicative day rates, used only for the instant estimate. */
const DAY_RATE: Record<(typeof VEHICLE_CLASSES)[number], number> = {
  boda: 2500,
  e_boda: 2500,
  go: 8000,
  plus: 10000,
  comfort: 12000,
  xl: 16000,
};

const CHAUFFEUR_DAY_RATE = 2500;
const STOP_ALLOWANCE = 600;

export function estimateHireTotal(input: {
  vehicleClass: (typeof VEHICLE_CLASSES)[number];
  driveMode: "self_drive" | "chauffeured";
  days: number;
  stops: number;
}) {
  const perDay = DAY_RATE[input.vehicleClass] + (input.driveMode === "chauffeured" ? CHAUFFEUR_DAY_RATE : 0);
  const extraStops = Math.max(0, input.stops - 2) * STOP_ALLOWANCE;
  return Math.round(perDay * input.days + extraStops);
}

/** Vehicles the team has listed as available for hire. */
export const listHireVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("vehicles")
      .select("id, make, model, colour, year, vehicle_class, hire_mode, hire_daily_rate, hire_notes")
      .eq("hire_available", true)
      .eq("status", "approved")
      .limit(50);
    return data ?? [];
  });

export const submitHireQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["corporate", "car_hire"]).default("corporate"),
        organisation: z.string().max(120).optional(),
        contactName: z.string().max(120).optional(),
        contactPhone: z.string().max(20).optional(),
        contactEmail: z.string().email().max(160).optional().or(z.literal("")),
        vehicleClass: z.enum(VEHICLE_CLASSES),
        driveMode: z.enum(["self_drive", "chauffeured"]).default("chauffeured"),
        startAt: z.string().min(10).max(40),
        days: z.number().int().min(1).max(90),
        passengers: z.number().int().min(1).max(60).default(1),
        stops: z.array(stopSchema).min(1).max(20),
        notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const startAt = new Date(data.startAt);
    if (Number.isNaN(startAt.getTime())) throw new Error("Choose a valid start date and time.");
    if (startAt.getTime() < Date.now() - 60_000) throw new Error("Choose a date and time in the future.");

    const estimate = estimateHireTotal({
      vehicleClass: data.vehicleClass,
      driveMode: data.driveMode,
      days: data.days,
      stops: data.stops.length,
    });

    const { data: row, error } = await supabaseAdmin
      .from("hire_quotes")
      .insert({
        requester_id: context.userId,
        kind: data.kind,
        organisation: data.organisation ?? null,
        contact_name: data.contactName ?? null,
        contact_phone: data.contactPhone ?? null,
        contact_email: data.contactEmail ? data.contactEmail : null,
        vehicle_class: data.vehicleClass,
        drive_mode: data.driveMode,
        start_at: startAt.toISOString(),
        days: data.days,
        passengers: data.passengers,
        stops: data.stops as never,
        notes: data.notes ?? null,
        estimated_total: estimate,
      })
      .select("id, reference, estimated_total, status")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { notify } = await import("./notifications.server");
      await notify({
        userId: context.userId,
        templateCode: "hire_quote_submitted",
        title: "Quotation request received",
        body: `Request ${row.reference}: estimated KES ${estimate.toLocaleString("en-KE")} for ${data.days} day(s). Our team will confirm the final price shortly.`,
        dedupeKey: `hire:${row.id}`,
        critical: true,
      });
    } catch (notifyError) {
      console.error("hire quote notification failed", notifyError);
    }

    return row;
  });

export const listMyHireQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("hire_quotes")
      .select("*")
      .eq("requester_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(30);
    return data ?? [];
  });

/** Ops queue: every request, newest first. */
export const listHireQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("hire_quotes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

export const decideHireQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["submitted", "quoted", "confirmed", "declined"]),
        quotedTotal: z.number().min(0).max(10_000_000).nullable().optional(),
        adminNotes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("hire_quotes")
      .update({
        status: data.status,
        quoted_total: data.quotedTotal ?? null,
        admin_notes: data.adminNotes ?? null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select("id, reference, requester_id, quoted_total, status")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { notify, audit } = await import("./notifications.server");
      await audit(context.userId, "hire_quote_decided", "hire_quote", data.id, { status: data.status });
      const price = row.quoted_total == null ? null : Number(row.quoted_total).toLocaleString("en-KE");
      await notify({
        userId: row.requester_id,
        templateCode: `hire_quote_${data.status}`,
        title: data.status === "declined" ? "Quotation update" : "Your quotation is ready",
        body:
          data.status === "declined"
            ? `Request ${row.reference} could not be fulfilled. ${data.adminNotes ?? ""}`.trim()
            : `Request ${row.reference}: KES ${price ?? "—"}. ${data.adminNotes ?? ""}`.trim(),
        dedupeKey: `hire:${row.id}:${data.status}`,
        critical: true,
      });
    } catch (notifyError) {
      console.error("hire decision notification failed", notifyError);
    }
    return { ok: true };
  });

/**
 * Car hire and corporate bookings.
 *
 * Two very different things share this file:
 *
 *  - Self-drive hire: the customer browses real listed cars (photo, plate,
 *    day rate), says where the car should be delivered and books it. They
 *    fuel the car themselves.
 *  - Chauffeured quotation: everything done for them — fuel and a driver.
 *    Owners/drivers (and our team) price it, the customer accepts or declines,
 *    and a declined offer leaves the request open for another owner with the
 *    same kind of vehicle.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const VEHICLE_CLASSES = ["go", "plus", "comfort", "xl", "boda", "e_boda"] as const;
type VehicleClass = (typeof VEHICLE_CLASSES)[number];

const stopSchema = z.object({
  label: z.string().min(2).max(160),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

/** Indicative day rates, used only when a listing has no rate of its own. */
const DAY_RATE: Record<VehicleClass, number> = {
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
  vehicleClass: VehicleClass;
  driveMode: "self_drive" | "chauffeured";
  days: number;
  stops: number;
  dailyRate?: number | null;
}) {
  const base = input.dailyRate && input.dailyRate > 0 ? input.dailyRate : DAY_RATE[input.vehicleClass];
  const perDay = base + (input.driveMode === "chauffeured" ? CHAUFFEUR_DAY_RATE : 0);
  const extraStops = Math.max(0, input.stops - 2) * STOP_ALLOWANCE;
  return Math.round(perDay * input.days + extraStops);
}

export interface HireVehicleRow {
  id: string;
  plate_number: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  year: number | null;
  seats: number | null;
  vehicle_class: VehicleClass;
  hire_mode: string | null;
  hire_daily_rate: number | null;
  hire_notes: string | null;
  hire_description: string | null;
  hire_available: boolean;
  photo_url: string | null;
  status: string;
  owner_driver_id: string | null;
  fleet_id: string | null;
}

/** Photos live in a private bucket, so customers get a short-lived link. */
async function withPhotos(rows: HireVehicleRow[]): Promise<Array<HireVehicleRow & { photo_link: string | null }>> {
  const paths = rows.map((row) => row.photo_url).filter((value): value is string => Boolean(value));
  if (paths.length === 0) return rows.map((row) => ({ ...row, photo_link: null }));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from("vehicle-photos").createSignedUrls(paths, 3600);
  const links = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
  return rows.map((row) => ({
    ...row,
    photo_link: row.photo_url ? (links.get(row.photo_url) ?? null) : null,
  }));
}

const VEHICLE_FIELDS =
  "id, plate_number, make, model, colour, year, seats, vehicle_class, hire_mode, hire_daily_rate, hire_notes, hire_description, hire_available, photo_url, status, owner_driver_id, fleet_id";

/** Every approved car currently listed for hire. */
export const listHireVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("vehicles")
      .select(VEHICLE_FIELDS)
      .eq("hire_available", true)
      .eq("status", "approved")
      .limit(60);
    const list = await withPhotos((data ?? []) as unknown as HireVehicleRow[]);
    return list.map((vehicle) => ({
      ...vehicle,
      day_rate:
        Number(vehicle.hire_daily_rate ?? 0) > 0
          ? Number(vehicle.hire_daily_rate)
          : DAY_RATE[vehicle.vehicle_class ?? "go"],
    }));
  });

/** Cars I own (directly or through my fleet), for managing their listing. */
export const listMyVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: fleets } = await context.supabase
      .from("fleets")
      .select("id")
      .eq("owner_id", context.userId);
    const fleetIds = (fleets ?? []).map((fleet) => fleet.id);
    const filter = fleetIds.length
      ? `owner_driver_id.eq.${context.userId},fleet_id.in.(${fleetIds.join(",")})`
      : `owner_driver_id.eq.${context.userId}`;
    const { data } = await context.supabase.from("vehicles").select(VEHICLE_FIELDS).or(filter);
    return withPhotos((data ?? []) as unknown as HireVehicleRow[]);
  });


/** Owners decide whether a car is available for hire, and at what day rate. */
export const updateVehicleHire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        hireAvailable: z.boolean().optional(),
        hireMode: z.enum(["self_drive", "chauffeured", "both"]).optional(),
        dailyRate: z.number().min(0).max(1_000_000).nullable().optional(),
        seats: z.number().int().min(1).max(60).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        photoPath: z.string().max(400).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.hireAvailable !== undefined) patch["hire_available"] = data.hireAvailable;
    if (data.hireMode !== undefined) patch["hire_mode"] = data.hireMode;
    if (data.dailyRate !== undefined) patch["hire_daily_rate"] = data.dailyRate;
    if (data.seats !== undefined) patch["seats"] = data.seats;
    if (data.description !== undefined) patch["hire_description"] = data.description;
    if (data.photoPath !== undefined) patch["photo_url"] = data.photoPath;
    if (Object.keys(patch).length === 0) return { ok: true };

    // RLS keeps this to the vehicle's owner or its fleet owner.
    const { error } = await context.supabase
      .from("vehicles")
      .update(patch as never)
      .eq("id", data.vehicleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const submitHireQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["corporate", "car_hire"]).default("corporate"),
        vehicleId: z.string().uuid().nullable().optional(),
        organisation: z.string().max(120).optional(),
        contactName: z.string().max(120).optional(),
        contactPhone: z.string().max(20).optional(),
        contactEmail: z.string().email().max(160).optional().or(z.literal("")),
        vehicleClass: z.enum(VEHICLE_CLASSES),
        driveMode: z.enum(["self_drive", "chauffeured"]).default("chauffeured"),
        startAt: z.string().min(10).max(40),
        days: z.number().int().min(1).max(90),
        passengers: z.number().int().min(1).max(60).default(1),
        /** Where the car should be delivered to start the drive. */
        pickupLabel: z.string().min(2).max(200),
        pickupLat: z.number().min(-90).max(90).nullable().optional(),
        pickupLng: z.number().min(-180).max(180).nullable().optional(),
        stops: z.array(stopSchema).max(20).default([]),
        notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const startAt = new Date(data.startAt);
    if (Number.isNaN(startAt.getTime())) throw new Error("Choose a valid start date and time.");
    if (startAt.getTime() < Date.now() - 60_000) throw new Error("Choose a date and time in the future.");

    let dailyRate: number | null = null;
    let vehicleClass = data.vehicleClass;
    if (data.vehicleId) {
      const { data: vehicle } = await supabaseAdmin
        .from("vehicles")
        .select("id, vehicle_class, hire_daily_rate, hire_available, status")
        .eq("id", data.vehicleId)
        .maybeSingle();
      if (!vehicle || !vehicle.hire_available || vehicle.status !== "approved") {
        throw new Error("That car is no longer available for hire.");
      }
      dailyRate = vehicle.hire_daily_rate == null ? null : Number(vehicle.hire_daily_rate);
      vehicleClass = vehicle.vehicle_class as VehicleClass;
    }

    const estimate = estimateHireTotal({
      vehicleClass,
      driveMode: data.driveMode,
      days: data.days,
      stops: data.stops.length,
      dailyRate,
    });

    const { data: row, error } = await supabaseAdmin
      .from("hire_quotes")
      .insert({
        requester_id: context.userId,
        kind: data.kind,
        vehicle_id: data.vehicleId ?? null,
        organisation: data.organisation ?? null,
        contact_name: data.contactName ?? null,
        contact_phone: data.contactPhone ?? null,
        contact_email: data.contactEmail ? data.contactEmail : null,
        vehicle_class: vehicleClass,
        drive_mode: data.driveMode,
        start_at: startAt.toISOString(),
        days: data.days,
        passengers: data.passengers,
        pickup_label: data.pickupLabel,
        pickup_lat: data.pickupLat ?? null,
        pickup_lng: data.pickupLng ?? null,
        stops: data.stops as never,
        notes: data.notes ?? null,
        estimated_total: estimate,
      } as never)
      .select("id, reference, estimated_total, status")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { notify } = await import("./notifications.server");
      await notify({
        userId: context.userId,
        templateCode: "hire_quote_submitted",
        title: data.driveMode === "self_drive" ? "Self-drive request received" : "Quotation request received",
        body: `Request ${row.reference}: KES ${estimate.toLocaleString("en-KE")} for ${data.days} day(s). The owner will confirm shortly.`,
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
    const quotes = data ?? [];
    if (quotes.length === 0) return [];
    const { data: offers } = await context.supabase
      .from("hire_offers")
      .select("*")
      .in(
        "quote_id",
        quotes.map((quote) => quote.id),
      )
      .order("price", { ascending: true });
    return quotes.map((quote) => ({
      ...quote,
      offers: (offers ?? []).filter((offer) => offer.quote_id === quote.id),
    }));
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

/**
 * Drivers and owners see the hire requests they can actually serve: open
 * requests for a class of vehicle they operate, plus the offers they made.
 */
export const listHireRequestsForProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets } = await context.supabase
      .from("fleets")
      .select("id")
      .eq("owner_id", context.userId);
    const fleetIds = (fleets ?? []).map((fleet) => fleet.id);

    const { data: owned } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate_number, vehicle_class, hire_daily_rate, status")
      .or(
        fleetIds.length
          ? `owner_driver_id.eq.${context.userId},fleet_id.in.(${fleetIds.join(",")})`
          : `owner_driver_id.eq.${context.userId}`,
      );
    const { data: authorised } = await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .select("vehicle_id, vehicles(id, plate_number, vehicle_class, hire_daily_rate, status)")
      .eq("driver_id", context.userId)
      .is("revoked_at", null);

    const vehicles = [
      ...(owned ?? []),
      ...((authorised ?? [])
        .map((row) => (row as { vehicles?: unknown }).vehicles)
        .filter(Boolean) as Array<{
        id: string;
        plate_number: string;
        vehicle_class: string;
        hire_daily_rate: number | null;
        status: string;
      }>),
    ].filter((vehicle, index, list) => list.findIndex((item) => item.id === vehicle.id) === index);

    const classes = [...new Set(vehicles.map((vehicle) => vehicle.vehicle_class))];
    if (classes.length === 0) return { vehicles: [], requests: [] };

    const { data: requests } = await supabaseAdmin
      .from("hire_quotes")
      .select("*")
      .in("status", ["submitted", "quoted"])
      .in("vehicle_class", classes)
      .order("start_at", { ascending: true })
      .limit(50);

    const ids = (requests ?? []).map((request) => request.id);
    const { data: offers } = ids.length
      ? await supabaseAdmin.from("hire_offers").select("*").in("quote_id", ids)
      : { data: [] as never[] };

    return {
      vehicles,
      requests: (requests ?? []).map((request) => ({
        ...request,
        offers: (offers ?? []).filter((offer) => offer.quote_id === request.id),
        my_offer: (offers ?? []).find(
          (offer) => offer.quote_id === request.id && offer.responder_id === context.userId,
        ),
      })),
    };
  });

/** A driver or owner offers to run the hire at a price. */
export const makeHireOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quoteId: z.string().uuid(),
        vehicleId: z.string().uuid(),
        price: z.number().min(0).max(10_000_000),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id, owner_driver_id, fleet_id, status")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (!vehicle || vehicle.status !== "approved") throw new Error("That vehicle is not approved.");

    const owns = vehicle.owner_driver_id === context.userId;
    const { data: mayDrive } = await supabaseAdmin.rpc("may_drive_vehicle", {
      _user_id: context.userId,
      _vehicle_id: data.vehicleId,
    });
    let ownsFleet = false;
    if (!owns && vehicle.fleet_id) {
      const { data: fleetOwned } = await supabaseAdmin.rpc("owns_fleet", {
        _user_id: context.userId,
        _fleet_id: vehicle.fleet_id,
      });
      ownsFleet = Boolean(fleetOwned);
    }
    if (!owns && !ownsFleet && !mayDrive) throw new Error("You cannot offer this vehicle.");

    const { data: quote } = await supabaseAdmin
      .from("hire_quotes")
      .select("id, reference, requester_id, status")
      .eq("id", data.quoteId)
      .maybeSingle();
    if (!quote || !["submitted", "quoted"].includes(quote.status)) {
      throw new Error("This request is already closed.");
    }

    const { error } = await supabaseAdmin.from("hire_offers").upsert(
      {
        quote_id: data.quoteId,
        responder_id: context.userId,
        vehicle_id: data.vehicleId,
        price: data.price,
        note: data.note ?? null,
        status: "offered",
      } as never,
      { onConflict: "quote_id,responder_id" },
    );
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("hire_quotes").update({ status: "quoted" }).eq("id", data.quoteId);

    try {
      const { notify } = await import("./notifications.server");
      await notify({
        userId: quote.requester_id,
        templateCode: "hire_offer_received",
        title: "You have a hire offer",
        body: `Request ${quote.reference}: an owner offered KES ${data.price.toLocaleString("en-KE")}. Open Hire to accept or decline.`,
        dedupeKey: `hire-offer:${data.quoteId}:${context.userId}:${data.price}`,
        critical: true,
      });
    } catch (notifyError) {
      console.error("hire offer notification failed", notifyError);
    }
    return { ok: true };
  });

/** The customer accepts one offer, or declines it so others can bid. */
export const respondToHireOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ offerId: z.string().uuid(), action: z.enum(["accept", "decline"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: offer } = await supabaseAdmin
      .from("hire_offers")
      .select("id, quote_id, responder_id, vehicle_id, price, status")
      .eq("id", data.offerId)
      .maybeSingle();
    if (!offer) throw new Error("That offer no longer exists.");

    const { data: quote } = await supabaseAdmin
      .from("hire_quotes")
      .select("id, reference, requester_id, status")
      .eq("id", offer.quote_id)
      .maybeSingle();
    if (!quote || quote.requester_id !== context.userId) throw new Error("Not your request.");

    if (data.action === "decline") {
      await supabaseAdmin.from("hire_offers").update({ status: "declined" }).eq("id", offer.id);
      const { count } = await supabaseAdmin
        .from("hire_offers")
        .select("id", { count: "exact", head: true })
        .eq("quote_id", offer.quote_id)
        .eq("status", "offered");
      if (!count) {
        await supabaseAdmin.from("hire_quotes").update({ status: "submitted" }).eq("id", offer.quote_id);
      }
    } else {
      await supabaseAdmin.from("hire_offers").update({ status: "accepted" }).eq("id", offer.id);
      await supabaseAdmin
        .from("hire_offers")
        .update({ status: "superseded" })
        .eq("quote_id", offer.quote_id)
        .neq("id", offer.id);
      await supabaseAdmin
        .from("hire_quotes")
        .update({
          status: "confirmed",
          quoted_total: offer.price,
          vehicle_id: offer.vehicle_id,
          assigned_driver_id: offer.responder_id,
          accepted_offer_id: offer.id,
        } as never)
        .eq("id", offer.quote_id);
    }

    try {
      const { notify } = await import("./notifications.server");
      await notify({
        userId: offer.responder_id,
        templateCode: `hire_offer_${data.action}ed`,
        title: data.action === "accept" ? "Your hire offer was accepted" : "Hire offer declined",
        body:
          data.action === "accept"
            ? `Request ${quote.reference} is yours at KES ${Number(offer.price).toLocaleString("en-KE")}.`
            : `Request ${quote.reference}: the customer declined your price. It is open to other owners.`,
        dedupeKey: `hire-offer:${offer.id}:${data.action}`,
        critical: true,
      });
    } catch (notifyError) {
      console.error("hire offer response notification failed", notifyError);
    }
    return { ok: true };
  });

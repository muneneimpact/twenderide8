import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(400).optional().nullable(),
});

const quoteSchema = z.object({
  pickup: pointSchema,
  dropoff: pointSchema,
  vehicleClass: z.enum(["boda", "economy", "comfort", "xl"]).default("economy"),
  pickupNotes: z.string().max(400).optional().nullable(),
});

const requestSchema = z.object({
  quoteId: z.string().uuid(),
  paymentMethod: z.enum(["stk_push", "cash"]),
  msisdn: z.string().max(20).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80),
});

/** Search places for pickup/destination, biased to Meru. */
export const searchPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ query: z.string().min(2).max(120), near: pointSchema.partial().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { getMapProvider } = await import("./adapters/map.server");
    const { MERU_CENTRE } = await import("./geo");
    const provider = getMapProvider();
    const near =
      data.near?.lat != null && data.near?.lng != null
        ? { lat: data.near.lat, lng: data.near.lng }
        : MERU_CENTRE;
    return provider.search(data.query, near);
  });

/** Reverse geocode a dragged pin. The coordinates stay the source of truth. */
export const reverseGeocode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => pointSchema.parse(input))
  .handler(async ({ data }) => {
    const { getMapProvider } = await import("./adapters/map.server");
    const place = await getMapProvider().reverse({ lat: data.lat, lng: data.lng });
    return {
      lat: data.lat,
      lng: data.lng,
      label: place?.label ?? null,
      address: place?.address ?? null,
      note: "The pin you set is the pickup point. The address is only a description.",
    };
  });

/**
 * Price the same route for every vehicle class so the customer can compare
 * before locking one. Nothing is persisted — the binding quote is created
 * only when a class is chosen.
 */
export const estimateClasses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ pickup: pointSchema, dropoff: pointSchema }).parse(input))
  .handler(async ({ data }) => {
    const { getMapProvider } = await import("./adapters/map.server");
    const { loadPricingContext } = await import("./pricing.server");
    const { computeFare } = await import("./fare-engine");

    const route = await getMapProvider().route(data.pickup, data.dropoff);
    if (route.distance_km <= 0) throw new Error("Pickup and destination are too close to price a ride.");

    const classes = ["boda", "economy", "comfort", "xl"] as const;
    const options: {
      vehicleClass: (typeof classes)[number];
      total: number;
      available: boolean;
    }[] = [];

    for (const vehicleClass of classes) {
      try {
        const pricing = await loadPricingContext(vehicleClass);
        const breakdown = computeFare({
          distanceKm: route.distance_km,
          durationMinutes: route.duration_minutes,
          config: pricing.config,
          policy: pricing.policy,
          modifiers: pricing.modifiers,
        });
        options.push({ vehicleClass, total: breakdown.total_fare, available: true });
      } catch {
        options.push({ vehicleClass, total: 0, available: false });
      }
    }

    return {
      distance_km: route.distance_km,
      duration_minutes: route.duration_minutes,
      options,
    };
  });


/** Server-authoritative itemised quote with a full pricing snapshot. */
export const createQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getMapProvider } = await import("./adapters/map.server");
    const { loadPricingContext, settingNumber } = await import("./pricing.server");
    const { computeFare } = await import("./fare-engine");

    const pricing = await loadPricingContext(data.vehicleClass);
    const route = await getMapProvider().route(data.pickup, data.dropoff);
    if (route.distance_km <= 0) throw new Error("Pickup and destination are too close to price a ride.");

    const breakdown = computeFare({
      distanceKm: route.distance_km,
      durationMinutes: route.duration_minutes,
      config: pricing.config,
      policy: pricing.policy,
      modifiers: pricing.modifiers,
    });

    const validitySeconds = settingNumber(pricing.settings, "quote_validity_seconds", 300);
    const { data: quote, error } = await supabaseAdmin
      .from("route_quotes")
      .insert({
        customer_id: context.userId,
        vehicle_class: data.vehicleClass,
        pickup_lat: data.pickup.lat,
        pickup_lng: data.pickup.lng,
        pickup_address: data.pickup.address ?? null,
        pickup_notes: data.pickupNotes ?? null,
        dropoff_lat: data.dropoff.lat,
        dropoff_lng: data.dropoff.lng,
        dropoff_address: data.dropoff.address ?? null,
        distance_km: route.distance_km,
        duration_minutes: route.duration_minutes,
        route_provider: route.provider,
        route_response: route.raw as never,
        polyline: route.polyline,
        breakdown: breakdown as never,
        unrounded_total: breakdown.unrounded_total,
        total_fare: breakdown.total_fare,
        fare_config_id: pricing.configId,
        distance_policy_id: pricing.policyId,
        pricing_snapshot: {
          config: pricing.config,
          policy: pricing.policy,
          modifiers: pricing.modifiers,
          traffic_aware: route.traffic_aware,
        } as never,
        expires_at: new Date(Date.now() + validitySeconds * 1000).toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { raw: _raw, ...routeSummary } = route;
    return { quote, breakdown, route: routeSummary };
  });

/** Accept a locked quote and create exactly one ride request, then dispatch. */
export const requestRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => requestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadSettings, settingNumber } = await import("./pricing.server");
    const { dispatchRide } = await import("./dispatch.server");
    const { notify, audit } = await import("./notifications.server");
    const { normaliseKenyanPhone } = await import("./phone");

    const existing = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();
    if (existing.data) return { ride: existing.data, duplicate: true };

    const { data: quote } = await supabaseAdmin
      .from("route_quotes")
      .select("*")
      .eq("id", data.quoteId)
      .eq("customer_id", context.userId)
      .maybeSingle();
    if (!quote) throw new Error("Quote not found.");
    if (new Date(quote.expires_at).getTime() < Date.now()) {
      throw new Error("This fare quote has expired. Please request a fresh quote.");
    }

    let msisdn: string | null = null;
    if (data.paymentMethod === "stk_push") {
      if (!data.msisdn) throw new Error("A mobile number is required for STK Push.");
      msisdn = normaliseKenyanPhone(data.msisdn);
    }

    const settings = await loadSettings();
    const snapshot = quote.pricing_snapshot as unknown as {
      config: { commission_percent: number; cancellation_fee: number; cancellation_free_seconds: number };
    };
    const commissionPercent = Number(snapshot.config.commission_percent);
    const commissionAmount = Number(((Number(quote.total_fare) * commissionPercent) / 100).toFixed(2));

    const { data: ride, error } = await supabaseAdmin
      .from("rides")
      .insert({
        customer_id: context.userId,
        quote_id: quote.id,
        status: "searching",
        payment_method: data.paymentMethod,
        payment_status: data.paymentMethod === "cash" ? "not_required" : "pending",
        idempotency_key: data.idempotencyKey,
        fare_snapshot: {
          breakdown: quote.breakdown,
          pricing: quote.pricing_snapshot,
          distance_km: quote.distance_km,
          duration_minutes: quote.duration_minutes,
          locked_at: new Date().toISOString(),
        } as never,
        total_fare: quote.total_fare,
        commission_percent: commissionPercent,
        commission_amount: commissionAmount,
        cancellation_policy_snapshot: {
          fee: Number(snapshot.config.cancellation_fee),
          free_seconds: Number(snapshot.config.cancellation_free_seconds),
        } as never,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("route_quotes").update({ accepted_at: new Date().toISOString() }).eq("id", quote.id);
    await supabaseAdmin
      .from("ride_status_events")
      .insert({ ride_id: ride.id, status: "searching", actor_id: context.userId, actor_role: "customer" });

    if (msisdn) {
      await supabaseAdmin.from("payment_intents").insert({
        ride_id: ride.id,
        customer_id: context.userId,
        method: "stk_push",
        amount: ride.total_fare,
        msisdn,
        status: "pending",
        idempotency_key: `intent:${data.idempotencyKey}`,
      });
    }

    const dispatch = await dispatchRide(
      ride.id,
      { lat: Number(quote.pickup_lat), lng: Number(quote.pickup_lng) },
      quote.vehicle_class,
      {
        radiusKm: settingNumber(settings, "dispatch_radius_km", 8),
        offerTimeoutSeconds: settingNumber(settings, "offer_timeout_seconds", 25),
        cashRide: data.paymentMethod === "cash",
      },
    );

    if (dispatch.offers === 0) {
      await supabaseAdmin.from("rides").update({ status: "no_driver_found" }).eq("id", ride.id);
      await supabaseAdmin
        .from("ride_status_events")
        .insert({ ride_id: ride.id, status: "no_driver_found", actor_role: "system" });
      await notify({
        userId: context.userId,
        templateCode: "no_driver",
        title: "No taxi available",
        body: "No driver was available nearby. No payment was requested.",
        rideId: ride.id,
        critical: true,
      });
      return { ride: { ...ride, status: "no_driver_found" as const }, duplicate: false, offers: 0 };
    }

    await audit(context.userId, "ride_requested", "ride", ride.id, { offers: dispatch.offers });
    return { ride, duplicate: false, offers: dispatch.offers };
  });

/** Full ride view for the participants. */
export const getRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: ride }, { data: events }, { data: locations }] = await Promise.all([
      supabase.from("rides").select("*").eq("id", data.rideId).maybeSingle(),
      supabase.from("ride_status_events").select("*").eq("ride_id", data.rideId).order("created_at"),
      supabase
        .from("ride_locations")
        .select("*")
        .eq("ride_id", data.rideId)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);
    if (!ride) throw new Error("Ride not found.");
    const { data: quote } = await supabase.from("route_quotes").select("*").eq("id", ride.quote_id).maybeSingle();
    const { data: intent } = await supabase
      .from("payment_intents")
      .select("*")
      .eq("ride_id", ride.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let driver: { full_name: string | null; phone: string | null } | null = null;
    let vehicle: { plate_number: string; make: string | null; model: string | null; colour: string | null } | null = null;
    if (ride.driver_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("id", ride.driver_id)
        .maybeSingle();
      driver = profile ?? null;
    }
    if (ride.vehicle_id) {
      const { data: v } = await supabase
        .from("vehicles")
        .select("plate_number, make, model, colour")
        .eq("id", ride.vehicle_id)
        .maybeSingle();
      vehicle = v ?? null;
    }
    return {
      ride,
      quote,
      events: events ?? [],
      lastLocation: locations?.[0] ?? null,
      payment: intent ?? null,
      driver,
      vehicle,
    };
  });

export const listMyRides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("rides")
      .select("*")
      .eq("customer_id", context.userId)
      .order("requested_at", { ascending: false })
      .limit(30);
    return data ?? [];
  });

/** Customer cancellation with a server-calculated, snapshotted fee. */
export const cancelRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rideId: z.string().uuid(), reason: z.string().max(300).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notify, audit } = await import("./notifications.server");

    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", data.rideId)
      .eq("customer_id", context.userId)
      .maybeSingle();
    if (!ride) throw new Error("Ride not found.");
    if (["trip_started", "trip_completed"].includes(ride.status)) {
      throw new Error("A trip that has already started cannot be cancelled here — contact support.");
    }
    if (ride.status.startsWith("cancelled")) return { ride, refund: null };

    const policy = ride.cancellation_policy_snapshot as unknown as { fee: number; free_seconds: number };
    const assignedAt = ride.assigned_at ? new Date(ride.assigned_at).getTime() : null;
    const withinFreeWindow =
      assignedAt === null || Date.now() - assignedAt <= (policy?.free_seconds ?? 120) * 1000;
    const fee = withinFreeWindow ? 0 : Number(policy?.fee ?? 0);

    await supabaseAdmin
      .from("rides")
      .update({
        status: "cancelled_by_customer",
        cancelled_by: "customer",
        cancellation_reason: data.reason ?? null,
        cancellation_fee: fee,
      })
      .eq("id", ride.id);
    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: ride.id,
      status: "cancelled_by_customer",
      actor_id: context.userId,
      actor_role: "customer",
      note: data.reason ?? null,
      metadata: { fee, within_free_window: withinFreeWindow } as never,
    });

    // Release the driver and vehicle.
    if (ride.driver_id) {
      await supabaseAdmin.from("driver_offers").update({ status: "superseded" }).eq("ride_id", ride.id);
      await notify({
        userId: ride.driver_id,
        templateCode: "ride_cancelled",
        title: "Ride cancelled",
        body: `Ride ${ride.reference} was cancelled by the customer.`,
        rideId: ride.id,
        critical: true,
      });
    }

    let refund = null;
    if (ride.payment_status === "paid") {
      const refundable = Number((Number(ride.total_fare) - fee).toFixed(2));
      if (refundable > 0) {
        const { data: created } = await supabaseAdmin
          .from("refunds")
          .insert({
            ride_id: ride.id,
            amount: refundable,
            reason: "Customer cancellation after payment",
            status: "pending",
            idempotency_key: `refund:${ride.id}`,
          })
          .select()
          .maybeSingle();
        refund = created;
        await supabaseAdmin.from("rides").update({ payment_status: "refund_pending" }).eq("id", ride.id);
      }
    }

    await audit(context.userId, "ride_cancelled", "ride", ride.id, { fee });
    return { ride: { ...ride, status: "cancelled_by_customer" as const, cancellation_fee: fee }, refund };
  });

export const rateRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ rideId: z.string().uuid(), score: z.number().int().min(1).max(5), comment: z.string().max(400).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: ride } = await context.supabase
      .from("rides")
      .select("id, driver_id, customer_id")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride?.driver_id) throw new Error("This ride cannot be rated.");
    const ratee = context.userId === ride.customer_id ? ride.driver_id : ride.customer_id;
    const { error } = await context.supabase.from("ratings").insert({
      ride_id: ride.id,
      rater_id: context.userId,
      ratee_id: ratee,
      score: data.score,
      comment: data.comment ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Public, read-only fare estimate. Writes nothing and never creates a ride. */
export const estimateFare = createServerFn({ method: "POST" })
  .inputValidator((input) => quoteSchema.parse(input))
  .handler(async ({ data }) => {
    const { getMapProvider } = await import("./adapters/map.server");
    const { loadPricingContext } = await import("./pricing.server");
    const { computeFare } = await import("./fare-engine");
    const pricing = await loadPricingContext(data.vehicleClass);
    const route = await getMapProvider().route(data.pickup, data.dropoff);
    const breakdown = computeFare({
      distanceKm: route.distance_km,
      durationMinutes: route.duration_minutes,
      config: pricing.config,
      policy: pricing.policy,
      modifiers: pricing.modifiers,
    });
    return {
      breakdown,
      distance_km: route.distance_km,
      duration_minutes: route.duration_minutes,
      provider: route.provider,
    };
  });

/** Public place search for the estimator on the landing screen. */
export const publicSearchPlaces = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ query: z.string().min(2).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const { getMapProvider } = await import("./adapters/map.server");
    const { MERU_CENTRE } = await import("./geo");
    return getMapProvider().search(data.query, MERU_CENTRE);
  });

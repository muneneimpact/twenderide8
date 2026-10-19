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
  /** Extra stops, in the order the customer arranged them. */
  stops: z.array(pointSchema).max(4).optional().default([]),
  vehicleClass: z.enum(["go", "plus", "comfort", "xl", "boda", "e_boda"]).default("go"),
  pickupNotes: z.string().max(400).optional().nullable(),
  promoCode: z.string().trim().max(40).optional().nullable(),
});

/**
 * Prices a trip that may pass through stops: each leg is routed in the order the
 * customer arranged them, and the legs are added up into one journey.
 */
export async function routeThroughStops(points: { lat: number; lng: number }[]): Promise<{
  distance_km: number;
  duration_minutes: number;
  provider: string;
  polyline: string | null;
  traffic_aware: boolean;
  raw: unknown;
}> {
  const { getMapProvider } = await import("./adapters/map.server");
  const provider = getMapProvider();
  const legs = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    legs.push(await provider.route(points[index]!, points[index + 1]!));
  }
  const first = legs[0]!;
  // Stitch the legs together so the drawn route still follows the road.
  let merged: string | null = first.polyline;
  if (legs.length > 1) {
    const { decodePolyline, encodePolyline } = await import("./polyline");
    const path: { lat: number; lng: number }[] = [];
    for (const leg of legs) {
      if (!leg.polyline) {
        merged = null;
        break;
      }
      for (const point of decodePolyline(leg.polyline)) path.push(point);
    }
    merged = path.length > 1 ? encodePolyline(path) : null;
  }
  return {
    distance_km: Number(legs.reduce((sum, leg) => sum + leg.distance_km, 0).toFixed(3)),
    duration_minutes: Number(legs.reduce((sum, leg) => sum + leg.duration_minutes, 0).toFixed(1)),
    provider: first.provider,
    polyline: merged,
    traffic_aware: first.traffic_aware,
    raw: { legs: legs.map((leg) => leg.raw) },
  };
}

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
    z
      .object({ query: z.string().min(2).max(120), near: pointSchema.partial().optional() })
      .parse(input),
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
  .inputValidator((input) =>
    z
      .object({
        pickup: pointSchema,
        dropoff: pointSchema,
        stops: z.array(pointSchema).max(4).optional().default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { loadPricingContext, settingNumber } = await import("./pricing.server");
    const { computeFare } = await import("./fare-engine");
    const { applyDiscount, drawDiscount, nairobiDayKey } = await import("./discounts");

    const route = await routeThroughStops([data.pickup, ...(data.stops ?? []), data.dropoff]);
    if (route.distance_km <= 0)
      throw new Error("Pickup and destination are too close to price a ride.");

    const classes = ["go", "plus", "comfort", "xl", "boda", "e_boda"] as const;
    const day = nairobiDayKey();
    const { nearestDriverKmByClass } = await import("./approach-fee.server");
    const { computeApproachFee } = await import("./approach-fee");
    const nearest = await nearestDriverKmByClass(data.pickup);
    const options: {
      vehicleClass: (typeof classes)[number];
      total: number;
      total_before_discount: number;
      discount_percent: number;
      discount_label: string | null;
      available: boolean;
      approach_fee: number;
      approach_distance_km: number;
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
        const discount = drawDiscount(
          `${context.userId}:${day}:${vehicleClass}`,
          settingNumber(pricing.settings, "random_discount_max_percent", 20),
          settingNumber(pricing.settings, "random_discount_chance_percent", 35),
        );
        const priced = applyDiscount(breakdown.total_fare, discount?.percent ?? 0);
        const approach = computeApproachFee(nearest.get(vehicleClass) ?? null, pricing.config.per_km);
        options.push({
          vehicleClass,
          total: priced.total_fare + approach.fee,
          total_before_discount: priced.total_before_discount + approach.fee,
          discount_percent: priced.discount_percent,
          discount_label: discount?.label ?? null,
          available: true,
          approach_fee: approach.fee,
          approach_distance_km: approach.distance_km,
        });
      } catch {
        options.push({
          vehicleClass,
          total: 0,
          total_before_discount: 0,
          discount_percent: 0,
          discount_label: null,
          available: false,
          approach_fee: 0,
          approach_distance_km: 0,
        });
      }
    }

    return {
      distance_km: route.distance_km,
      duration_minutes: route.duration_minutes,
      polyline: route.polyline,
      options,
    };
  });

/** Server-authoritative itemised quote with a full pricing snapshot. */
export const createQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPricingContext, settingNumber } = await import("./pricing.server");
    const { computeFare } = await import("./fare-engine");
    const { applyDiscount, drawDiscount, nairobiDayKey } = await import("./discounts");

    const pricing = await loadPricingContext(data.vehicleClass);
    const route = await routeThroughStops([data.pickup, ...(data.stops ?? []), data.dropoff]);
    if (route.distance_km <= 0)
      throw new Error("Pickup and destination are too close to price a ride.");

    const computed = computeFare({
      distanceKm: route.distance_km,
      durationMinutes: route.duration_minutes,
      config: pricing.config,
      policy: pricing.policy,
      modifiers: pricing.modifiers,
    });

    // A valid promo code takes precedence over the deterministic daily draw. The
    // server is the only authority that decides whether a code may be used and
    // it enforces the offer's configured maximum discount.
    let discountPercent = 0;
    let discountLabel: string | null = null;
    let promoInfo: { promotionId: string; code: string; name: string } | null = null;

    if (data.promoCode) {
      const { promoState, applyPromo } = await import("./discounts");
      const code = data.promoCode.toUpperCase();
      const { data: promoRows } = await supabaseAdmin
        .from("promotions")
        .select("*")
        .eq("code", code)
        .limit(1);
      const promo = promoRows?.[0];
      if (promo && promoState(promo) === "active") {
        const applied = applyPromo(computed.total_fare, promo);
        if (!applied.blocked_min_fare) {
          discountPercent = applied.discount_percent;
          discountLabel = `${promo.code} applied`;
          promoInfo = { promotionId: promo.id, code: promo.code, name: promo.name };
        }
      }
    }

    // Only fall back to the deterministic daily draw when no promo was applied.
    if (!promoInfo) {
      const discount = drawDiscount(
        `${context.userId}:${nairobiDayKey()}:${data.vehicleClass}`,
        settingNumber(pricing.settings, "random_discount_max_percent", 20),
        settingNumber(pricing.settings, "random_discount_chance_percent", 35),
      );
      discountPercent = discount?.percent ?? 0;
      discountLabel = discount?.label ?? null;
    }

    const priced = applyDiscount(computed.total_fare, discountPercent);
    const { nearestDriverKmByClass } = await import("./approach-fee.server");
    const { computeApproachFee } = await import("./approach-fee");
    const nearest = (await nearestDriverKmByClass(data.pickup)).get(data.vehicleClass) ?? null;
    const approach = computeApproachFee(nearest, pricing.config.per_km);
    const breakdown = {
      ...computed,
      total_fare: priced.total_fare + approach.fee,
      // The whole approach fee goes to the driver to cover the empty drive.
      net_provider_earning: computed.net_provider_earning + approach.fee,
      approach_fee: approach.fee,
      approach_percent: approach.percent,
      approach_distance_km: approach.distance_km,
      discount_percent: priced.discount_percent,
      discount_amount: priced.discount_amount,
      discount_label: discountLabel,
      total_before_discount: priced.total_before_discount + approach.fee,
      ...(promoInfo ? { promo: promoInfo } : {}),
    };

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
        stops: (data.stops ?? []) as never,

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
          discount: {
            percent: priced.discount_percent,
            amount: priced.discount_amount,
            ...(promoInfo ? { promo: promoInfo } : {}),
          },
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

/** Create a delivery quote using the selected company's current Ops-approved rate card. */
export const createDeliveryQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pickup: pointSchema,
        dropoff: pointSchema,
        stops: z.array(pointSchema).max(4).optional().default([]),
        vehicleClass: z.enum(["go", "plus", "comfort", "xl", "boda", "e_boda"]),
        deliveryFleetId: z.string().uuid(),
        pickupNotes: z.string().max(400).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPricingContext, settingNumber } = await import("./pricing.server");
    const { data: fleet } = await supabaseAdmin
      .from("fleets")
      .select(
        "id, business_name, delivery_business_name, status, delivery_enabled, delivery_rate_status, delivery_base_fee, delivery_per_km, delivery_per_minute, delivery_minimum_fee",
      )
      .eq("id", data.deliveryFleetId)
      .maybeSingle();
    if (
      !fleet ||
      fleet.status !== "approved" ||
      !fleet.delivery_enabled ||
      fleet.delivery_rate_status !== "approved"
    ) {
      throw new Error(
        "This delivery company is not currently accepting bookings. Choose another company.",
      );
    }
    const pricing = await loadPricingContext(data.vehicleClass);
    const route = await routeThroughStops([data.pickup, ...(data.stops ?? []), data.dropoff]);
    if (route.distance_km <= 0)
      throw new Error("Pickup and destination are too close to price a delivery.");
    const baseFee = Number(fleet.delivery_base_fee ?? 0);
    const distanceFee = Number((route.distance_km * Number(fleet.delivery_per_km ?? 0)).toFixed(2));
    const timeFee = Number(
      (route.duration_minutes * Number(fleet.delivery_per_minute ?? 0)).toFixed(2),
    );
    const total = Number(
      Math.max(Number(fleet.delivery_minimum_fee ?? 0), baseFee + distanceFee + timeFee).toFixed(2),
    );
    if (!(total > 0))
      throw new Error("This company's approved rate card returned an invalid delivery price.");
    const breakdown = {
      fare_type: "delivery_company_rate_card",
      company: { id: fleet.id, name: fleet.delivery_business_name ?? fleet.business_name },
      base_fee: baseFee,
      distance_km: route.distance_km,
      per_km: Number(fleet.delivery_per_km ?? 0),
      distance_fee: distanceFee,
      duration_minutes: route.duration_minutes,
      per_minute: Number(fleet.delivery_per_minute ?? 0),
      time_fee: timeFee,
      minimum_fee: Number(fleet.delivery_minimum_fee ?? 0),
      total_fare: total,
    };
    const validitySeconds = settingNumber(pricing.settings, "quote_validity_seconds", 300);
    const { data: quote, error } = await supabaseAdmin
      .from("route_quotes")
      .insert({
        customer_id: context.userId,
        vehicle_class: data.vehicleClass,
        trip_kind: "delivery",
        delivery_fleet_id: fleet.id,
        pickup_lat: data.pickup.lat,
        pickup_lng: data.pickup.lng,
        pickup_address: data.pickup.address ?? null,
        pickup_notes: data.pickupNotes ?? null,
        dropoff_lat: data.dropoff.lat,
        dropoff_lng: data.dropoff.lng,
        dropoff_address: data.dropoff.address ?? null,
        stops: (data.stops ?? []) as never,
        distance_km: route.distance_km,
        duration_minutes: route.duration_minutes,
        route_provider: route.provider,
        route_response: route.raw as never,
        polyline: route.polyline,
        breakdown: breakdown as never,
        unrounded_total: total,
        total_fare: total,
        fare_config_id: null,
        distance_policy_id: null,
        pricing_snapshot: {
          config: pricing.config,
          delivery: {
            fleet_id: fleet.id,
            business_name: fleet.business_name,
            base_fee: baseFee,
            per_km: Number(fleet.delivery_per_km ?? 0),
            per_minute: Number(fleet.delivery_per_minute ?? 0),
            minimum_fee: Number(fleet.delivery_minimum_fee ?? 0),
          },
          discount: { percent: 0, amount: 0 },
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
      config: {
        commission_percent: number;
        cancellation_fee: number;
        cancellation_free_seconds: number;
      };
      discount?: { percent: number; amount: number };
    };
    const commissionPercent = Number(snapshot.config.commission_percent);
    const charged = Number(quote.total_fare);
    const discountAmount = Number(snapshot.discount?.amount ?? 0);
    // Launch promise: Twende funds customer discounts out of its own commission
    // so the driver or fleet still earns the full undiscounted fare. A floor
    // keeps the platform share positive, and the promise ends on a set date.
    const promoUntil = String(
      settings["discount_absorption_until"] ?? new Date(Date.now() + 182 * 86400000).toISOString(),
    );
    const absorbing = discountAmount > 0 && Date.now() < new Date(promoUntil).getTime();
    const nominalCommission = Number(
      (((charged + discountAmount) * commissionPercent) / 100).toFixed(2),
    );
    const floorPercent = settingNumber(settings, "min_commission_percent", 5);
    const commissionFloor = Number((((charged + discountAmount) * floorPercent) / 100).toFixed(2));
    const absorbed = absorbing
      ? Math.min(discountAmount, Math.max(0, nominalCommission - commissionFloor))
      : 0;
    const commissionAmount = Number(Math.max(0, nominalCommission - absorbed).toFixed(2));

    const { data: ride, error } = await supabaseAdmin
      .from("rides")
      .insert({
        customer_id: context.userId,
        quote_id: quote.id,
        trip_kind: quote.trip_kind ?? "cab",
        fleet_id: quote.delivery_fleet_id ?? null,
        status: "searching",
        payment_method: data.paymentMethod,
        payment_status: data.paymentMethod === "cash" ? "not_required" : "pending",
        idempotency_key: data.idempotencyKey,
        fare_snapshot: {
          breakdown: quote.breakdown,
          pricing: quote.pricing_snapshot,
          distance_km: quote.distance_km,
          duration_minutes: quote.duration_minutes,
          discount_absorption: {
            discount_amount: discountAmount,
            absorbed_by_platform: Number(absorbed.toFixed(2)),
            nominal_commission: nominalCommission,
            commission_floor_percent: floorPercent,
            promise_until: promoUntil,
          },
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

    await supabaseAdmin
      .from("route_quotes")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", quote.id);
    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: ride.id,
      status: "searching",
      actor_id: context.userId,
      actor_role: "customer",
    });

    // Record the promo redemption once per ride, then move the usage counter.
    const usedPromo = (quote.breakdown as { promo?: { promotionId: string; code: string } } | null)
      ?.promo;
    if (usedPromo?.promotionId) {
      const { error: redeemError } = await supabaseAdmin.from("promotion_redemptions").insert({
        promotion_id: usedPromo.promotionId,
        customer_id: context.userId,
        ride_id: ride.id,
        code: usedPromo.code,
        discount_amount: discountAmount,
      });
      if (!redeemError) {
        const { data: current } = await supabaseAdmin
          .from("promotions")
          .select("usage_count")
          .eq("id", usedPromo.promotionId)
          .maybeSingle();
        await supabaseAdmin
          .from("promotions")
          .update({ usage_count: (current?.usage_count ?? 0) + 1 })
          .eq("id", usedPromo.promotionId);
      }
    }

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

const arrivalEstimateCache = new Map<
  string,
  {
    status: string;
    at: number;
    lat: number;
    lng: number;
    value: { etaMinutes: number | null; distanceKm: number | null; routePolyline: string | null };
  }
>();

/** Full ride view for the participants. */
export const getRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: ride }, { data: events }, { data: locations }] = await Promise.all([
      supabase.from("rides").select("*").eq("id", data.rideId).maybeSingle(),
      supabase
        .from("ride_status_events")
        .select("*")
        .eq("ride_id", data.rideId)
        .order("created_at"),
      supabase
        .from("ride_locations")
        .select("*")
        .eq("ride_id", data.rideId)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);
    if (!ride) throw new Error("Ride not found.");
    const { data: quote } = await supabase
      .from("route_quotes")
      .select("*")
      .eq("id", ride.quote_id)
      .maybeSingle();
    const { data: intent } = await supabase
      .from("payment_intents")
      .select("*")
      .eq("ride_id", ride.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let driver: { full_name: string | null; phone: string | null; photoUrl: string | null } | null =
      null;
    let vehicle: {
      plate_number: string;
      make: string | null;
      model: string | null;
      colour: string | null;
    } | null = null;
    if (ride.driver_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone, avatar_url")
        .eq("id", ride.driver_id)
        .maybeSingle();
      if (profile) {
        // The photo lives in a private bucket, so the rider gets a short-lived link.
        let photoUrl: string | null = null;
        if (profile.avatar_url) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: signed } = await supabaseAdmin.storage
            .from("driver-documents")
            .createSignedUrl(profile.avatar_url, 3600);
          photoUrl = signed?.signedUrl ?? null;
        }
        driver = { full_name: profile.full_name, phone: profile.phone, photoUrl };
      }
    }

    if (ride.vehicle_id) {
      const { data: v } = await supabase
        .from("vehicles")
        .select("plate_number, make, model, colour, vehicle_class")
        .eq("id", ride.vehicle_id)
        .maybeSingle();
      vehicle = v ?? null;
    }

    const lastLocation = locations?.[0] ?? null;
    let tracking = {
      etaMinutes: null as number | null,
      distanceKm: null as number | null,
      routePolyline: null as string | null,
      locationUpdatedAt: lastLocation?.recorded_at ?? null,
    };
    const activeTracking = [
      "driver_assigned",
      "driver_arriving",
      "driver_arrived",
      "trip_started",
    ].includes(ride.status);
    if (activeTracking && lastLocation && quote && ride.status === "driver_arrived") {
      tracking.etaMinutes = 0;
    } else if (activeTracking && lastLocation && quote && !ride.queued_after_ride_id) {
      const locationAgeMs = Date.now() - new Date(lastLocation.recorded_at).getTime();
      if (locationAgeMs >= 0 && locationAgeMs < 5 * 60_000) {
        const target =
          ride.status === "trip_started"
            ? { lat: Number(quote.dropoff_lat), lng: Number(quote.dropoff_lng) }
            : { lat: Number(quote.pickup_lat), lng: Number(quote.pickup_lng) };
        const cacheKey = `${ride.id}:${ride.status}:${target.lat.toFixed(4)}:${target.lng.toFixed(4)}`;
        const cached = arrivalEstimateCache.get(cacheKey);
        const currentLat = Number(lastLocation.lat);
        const currentLng = Number(lastLocation.lng);
        if (
          cached &&
          Date.now() - cached.at < 30_000 &&
          Math.hypot(currentLat - cached.lat, currentLng - cached.lng) < 0.002
        ) {
          tracking = { ...tracking, ...cached.value };
        } else {
          try {
            const { getMapProvider } = await import("./adapters/map.server");
            const road = await getMapProvider().route({ lat: currentLat, lng: currentLng }, target);
            const value = {
              etaMinutes: Math.max(1, Math.ceil(road.duration_minutes)),
              distanceKm: Number(road.distance_km.toFixed(2)),
              routePolyline: road.polyline,
            };
            arrivalEstimateCache.set(cacheKey, {
              status: ride.status,
              at: Date.now(),
              lat: currentLat,
              lng: currentLng,
              value,
            });
            if (arrivalEstimateCache.size > 500) {
              const oldestKey = arrivalEstimateCache.keys().next().value;
              if (oldestKey) arrivalEstimateCache.delete(oldestKey);
            }
            tracking = { ...tracking, ...value };
          } catch {
            const { haversineKm } = await import("./geo");
            const distanceKm = haversineKm(
              { lat: Number(lastLocation.lat), lng: Number(lastLocation.lng) },
              target,
            );
            tracking = {
              ...tracking,
              distanceKm: Number(distanceKm.toFixed(2)),
              etaMinutes: Math.max(1, Math.ceil(distanceKm * 2.8 + 1)),
            };
          }
        }
      }
    }
    return {
      ride,
      quote,
      events: events ?? [],
      lastLocation,
      tracking,
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
    const rides = data ?? [];

    // Each trip is named by where it went, so the list reads like a journey
    // rather than a row of reference codes.
    const quoteIds = rides.map((ride) => ride.quote_id).filter((id): id is string => Boolean(id));
    const { data: quotes } = quoteIds.length
      ? await context.supabase
          .from("route_quotes")
          .select("id, pickup_address, dropoff_address")
          .in("id", quoteIds)
      : { data: [] };
    const byId = new Map((quotes ?? []).map((quote) => [quote.id, quote]));

    return rides.map((ride) => {
      const quote = ride.quote_id ? byId.get(ride.quote_id) : undefined;
      const from = quote?.pickup_address ?? null;
      const to = quote?.dropoff_address ?? null;
      return {
        ...ride,
        pickup_address: from,
        dropoff_address: to,
        trip_name: to ? (from ? `${from} → ${to}` : to) : ride.reference,
      };
    });
  });

/** Customer cancellation with a server-calculated, snapshotted fee. */
export const cancelRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rideId: z.string().uuid(),
        reason: z.string().trim().min(3).max(300),
        reasonCode: z.string().max(60).optional(),
      })
      .parse(input),
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
      throw new Error(
        "A trip that has already started cannot be cancelled here — contact support.",
      );
    }
    if (ride.status.startsWith("cancelled")) return { ride, refund: null };

    const policy = ride.cancellation_policy_snapshot as unknown as {
      fee: number;
      free_seconds: number;
    };
    const assignedAt = ride.assigned_at ? new Date(ride.assigned_at).getTime() : null;
    const withinFreeWindow =
      assignedAt === null || Date.now() - assignedAt <= (policy?.free_seconds ?? 120) * 1000;
    const fee = withinFreeWindow ? 0 : Number(policy?.fee ?? 0);

    await supabaseAdmin
      .from("rides")
      .update({
        status: "cancelled_by_customer",
        cancelled_by: "customer",
        cancellation_reason: data.reasonCode ? `${data.reasonCode}: ${data.reason}` : data.reason,
        cancellation_fee: fee,
      })
      .eq("id", ride.id);
    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: ride.id,
      status: "cancelled_by_customer",
      actor_id: context.userId,
      actor_role: "customer",
      note: data.reason,
      metadata: {
        fee,
        within_free_window: withinFreeWindow,
        reason_code: data.reasonCode ?? null,
      } as never,
    });

    // Release the driver and vehicle.
    if (ride.driver_id) {
      await supabaseAdmin
        .from("driver_offers")
        .update({ status: "superseded" })
        .eq("ride_id", ride.id);
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
        await supabaseAdmin
          .from("rides")
          .update({ payment_status: "refund_pending" })
          .eq("id", ride.id);
      }
    }

    await audit(context.userId, "ride_cancelled", "ride", ride.id, { fee });
    return {
      ride: { ...ride, status: "cancelled_by_customer" as const, cancellation_fee: fee },
      refund,
    };
  });

export const rateRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rideId: z.string().uuid(),
        score: z.number().int().min(1).max(5),
        comment: z.string().max(400).optional(),
      })
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

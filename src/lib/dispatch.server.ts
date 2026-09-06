/** Server-only dispatch: hex-indexed driver search, road ranking, offers. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { haversineKm } from "./geo";
import { hexKey, hexOf, hexRing, ringsWithin } from "./hex";
import { notify } from "./notifications.server";

export interface DispatchResult {
  offers: number;
  candidates: { driver_id: string; distance_km: number; eta_minutes: number }[];
}

/** Never chase a driver who is further away than this, whatever the settings say. */
export const MAX_DISPATCH_RADIUS_KM = 5;
/** Enough candidates to survive a couple of declines without spamming the city. */
const TARGET_CANDIDATES = 3;
/** A driver this close is offered the job alone — no need to wake anyone else. */
const SOLO_OFFER_KM = 1.5;
/** Cap on paid road-distance lookups per dispatch. */
const MAX_ROAD_LOOKUPS = 4;
/** A trip untouched for this long is treated as abandoned, not in progress. */
const ABANDONED_RIDE_MS = 3 * 60 * 60 * 1000;

interface EligibleDriver {
  driver_id: string;
  vehicle_id: string;
  lat: number;
  lng: number;
  /** Set when the driver is still finishing a trip that ends near this pickup. */
  finishing_ride_id?: string | null;
  /** Rough minutes left on that current trip before they can set off. */
  finishing_minutes?: number;
}

/** How close a running trip must end to the new pickup before we chain it. */
export const CHAIN_HANDOVER_KM = 3;
/** Assumed minutes still to run on a trip we chain behind. */
const CHAIN_TAIL_MINUTES = 6;

/**
 * Approved, online drivers of the right class. Idle drivers come first, but a
 * driver whose current trip ends close to this pickup is also eligible: they
 * can line the job up and set off the moment they drop their passenger.
 */
async function eligibleDrivers(
  vehicleClass: string,
  cashRide: boolean,
  pickup: { lat: number; lng: number },
): Promise<EligibleDriver[]> {
  const { data: drivers } = await supabaseAdmin
    .from("drivers")
    .select("id, active_vehicle_id, last_lat, last_lng, cash_jobs_blocked, status, is_online")
    .eq("is_online", true)
    .eq("status", "approved")
    .not("active_vehicle_id", "is", null);

  // Only genuinely live trips block a driver. A job that has sat untouched for
  // hours was abandoned (app closed mid-trip) and must not lock the driver out
  // of every future request.
  const { data: liveRides } = await supabaseAdmin
    .from("rides")
    .select("id, driver_id, status, quote_id, queued_after_ride_id")
    .in("status", ["driver_assigned", "driver_arriving", "driver_arrived", "trip_started"])
    .gt("updated_at", new Date(Date.now() - ABANDONED_RIDE_MS).toISOString());

  const busy = new Set<string>();
  // Drivers who already have a job lined up behind their current one are full.
  const chainable = new Map<string, { rideId: string; quoteId: string }>();
  for (const ride of liveRides ?? []) {
    if (!ride.driver_id) continue;
    busy.add(ride.driver_id);
    if (ride.queued_after_ride_id) continue;
    if (ride.status === "trip_started") chainable.set(ride.driver_id, { rideId: ride.id, quoteId: ride.quote_id });
  }
  // A driver already carrying a queued ride must never be chained twice.
  for (const ride of liveRides ?? []) {
    if (ride.driver_id && ride.queued_after_ride_id) chainable.delete(ride.driver_id);
  }

  // Where each chainable trip ends decides whether it is worth chaining.
  const quoteIds = [...chainable.values()].map((entry) => entry.quoteId);
  const { data: quotes } = quoteIds.length
    ? await supabaseAdmin.from("route_quotes").select("id, dropoff_lat, dropoff_lng").in("id", quoteIds)
    : { data: [] };
  const quoteMap = new Map((quotes ?? []).map((q) => [q.id, q]));

  // Concurrency: a driver holding a live offer for another request is not
  // offered a second one, so simultaneous bookings fan out to distinct drivers.
  const { data: pending } = await supabaseAdmin
    .from("driver_offers")
    .select("driver_id")
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString());
  for (const row of pending ?? []) {
    busy.add(row.driver_id);
    chainable.delete(row.driver_id);
  }

  const vehicleIds = (drivers ?? []).map((d) => d.active_vehicle_id).filter(Boolean) as string[];
  const { data: vehicles } = vehicleIds.length
    ? await supabaseAdmin.from("vehicles").select("id, vehicle_class, status").in("id", vehicleIds)
    : { data: [] };
  const vehicleMap = new Map((vehicles ?? []).map((v) => [v.id, v]));

  const eligible: EligibleDriver[] = [];
  for (const driver of drivers ?? []) {
    if (cashRide && driver.cash_jobs_blocked) continue;
    const vehicle = driver.active_vehicle_id ? vehicleMap.get(driver.active_vehicle_id) : null;
    if (!vehicle || vehicle.status !== "approved" || vehicle.vehicle_class !== vehicleClass) continue;

    if (!busy.has(driver.id)) {
      if (driver.last_lat == null || driver.last_lng == null) continue;
      eligible.push({
        driver_id: driver.id,
        vehicle_id: driver.active_vehicle_id as string,
        lat: Number(driver.last_lat),
        lng: Number(driver.last_lng),
      });
      continue;
    }

    const chain = chainable.get(driver.id);
    if (!chain) continue;
    const quote = quoteMap.get(chain.quoteId);
    if (!quote) continue;
    const endsAt = { lat: Number(quote.dropoff_lat), lng: Number(quote.dropoff_lng) };
    if (haversineKm(endsAt, pickup) > CHAIN_HANDOVER_KM) continue;
    eligible.push({
      driver_id: driver.id,
      vehicle_id: driver.active_vehicle_id as string,
      // Rank them from where they will actually be free, not where they are now.
      lat: endsAt.lat,
      lng: endsAt.lng,
      finishing_ride_id: chain.rideId,
      finishing_minutes: CHAIN_TAIL_MINUTES,
    });
  }
  return eligible;
}


/**
 * Walks hex rings outward from the pickup hex, collecting drivers until we have
 * enough candidates or we run out of rings inside the radius.
 */
export function searchHexRings(
  pickup: { lat: number; lng: number },
  drivers: EligibleDriver[],
  radiusKm: number,
  target = TARGET_CANDIDATES,
): Array<EligibleDriver & { straight_km: number }> {
  const bins = new Map<string, EligibleDriver[]>();
  for (const driver of drivers) {
    const key = hexKey(hexOf(driver));
    const bin = bins.get(key);
    if (bin) bin.push(driver);
    else bins.set(key, [driver]);
  }

  const centre = hexOf(pickup);
  const found: Array<EligibleDriver & { straight_km: number }> = [];
  const maxRings = ringsWithin(radiusKm);

  for (let ring = 0; ring <= maxRings; ring += 1) {
    for (const hex of hexRing(centre, ring)) {
      for (const driver of bins.get(hexKey(hex)) ?? []) {
        const straight = haversineKm(pickup, driver);
        if (straight > radiusKm) continue;
        found.push({ ...driver, straight_km: Number(straight.toFixed(3)) });
      }
    }
    if (found.length >= target && ring >= 1) break;
  }

  return found.sort((a, b) => a.straight_km - b.straight_km);
}

export async function dispatchRide(
  rideId: string,
  pickup: { lat: number; lng: number },
  vehicleClass: "go" | "plus" | "comfort" | "xl" | "boda" | "e_boda",
  options: { radiusKm: number; offerTimeoutSeconds: number; cashRide: boolean },
): Promise<DispatchResult> {
  const radiusKm = Math.min(options.radiusKm, MAX_DISPATCH_RADIUS_KM);
  // Self-heal before searching so an abandoned trip cannot hide a free driver.
  await closeAbandonedRides();
  const drivers = await eligibleDrivers(vehicleClass, options.cashRide, pickup);
  const nearby = searchHexRings(pickup, drivers, radiusKm).slice(0, MAX_ROAD_LOOKUPS);
  if (nearby.length === 0) return { offers: 0, candidates: [] };

  // Rank the short list by how far the driver must actually drive on the road,
  // not by how the crow flies. Only the short list costs a provider call.
  const { getMapProvider } = await import("./adapters/map.server");
  const provider = getMapProvider();
  const ranked = await Promise.all(
    nearby.map(async (driver) => {
      // A driver finishing a trip still has to complete it before setting off.
      const tail = driver.finishing_ride_id ? (driver.finishing_minutes ?? 0) : 0;
      try {
        const route = await provider.route({ lat: driver.lat, lng: driver.lng }, pickup);
        return {
          ...driver,
          road_km: Number(route.distance_km.toFixed(3)),
          eta_minutes: Number((route.duration_minutes + tail).toFixed(1)),
        };
      } catch {
        return {
          ...driver,
          road_km: Number((driver.straight_km * 1.35).toFixed(3)),
          eta_minutes: Number((driver.straight_km * 2.8 + 1 + tail).toFixed(1)),
        };
      }
    }),
  );
  ranked.sort((a, b) => a.eta_minutes - b.eta_minutes || a.road_km - b.road_km);

  const best = ranked[0]!;
  const offerCount =
    best.road_km <= SOLO_OFFER_KM && !best.finishing_ride_id
      ? 1
      : Math.min(ranked.length, TARGET_CANDIDATES);
  const candidates = ranked.slice(0, offerCount).map((driver) => ({
    driver_id: driver.driver_id,
    vehicle_id: driver.vehicle_id,
    distance_km: driver.road_km,
    eta_minutes: driver.eta_minutes,
    finishing_ride_id: driver.finishing_ride_id ?? null,
  }));

  const expiresAt = new Date(Date.now() + options.offerTimeoutSeconds * 1000).toISOString();
  // Re-dispatching the same ride must refresh an existing offer row rather
  // than collide with the (ride_id, driver_id) unique key.
  await supabaseAdmin.from("driver_offers").upsert(
    candidates.map((candidate) => ({
      ride_id: rideId,
      driver_id: candidate.driver_id,
      vehicle_id: candidate.vehicle_id,
      status: "offered",
      responded_at: null,
      distance_km: candidate.distance_km,
      eta_minutes: candidate.eta_minutes,
      expires_at: expiresAt,
    })),
    { onConflict: "ride_id,driver_id" },
  );

  for (const candidate of candidates) {
    await notify({
      userId: candidate.driver_id,
      templateCode: "ride_offer",
      title: candidate.finishing_ride_id ? "Next ride after this trip" : "New ride request",
      body: candidate.finishing_ride_id
        ? `A customer needs a taxi near where your current trip ends (about ${Math.round(candidate.eta_minutes)} min away). Accept now and head there once you drop off.`
        : `A customer needs a taxi ${candidate.distance_km.toFixed(1)} km away (about ${Math.round(candidate.eta_minutes)} min).`,
      rideId,
      dedupeKey: `offer:${rideId}:${candidate.driver_id}`,
    });
  }

  // Every other free driver in range still sees the job on their open board,
  // so they get an alert on their phone too — without a personal offer.
  const offered = new Set(candidates.map((candidate) => candidate.driver_id));
  const wider = searchHexRings(pickup, drivers, radiusKm, 12).filter(
    (driver) => !offered.has(driver.driver_id) && !driver.finishing_ride_id,
  );
  for (const driver of wider.slice(0, 8)) {
    await notify({
      userId: driver.driver_id,
      templateCode: "ride_open",
      title: "New ride available",
      body: `A customer nearby (about ${driver.straight_km.toFixed(1)} km) is looking for a taxi. Open the app to take it.`,
      rideId,
      dedupeKey: `open:${rideId}:${driver.driver_id}`,
    });
  }

  return {
    offers: candidates.length,
    candidates: candidates.map(({ driver_id, distance_km, eta_minutes }) => ({
      driver_id,
      distance_km,
      eta_minutes,
    })),
  };
}

/** Expires stale offers and rides that never found a driver. */
export async function expireStaleDispatch() {
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("driver_offers")
    .update({ status: "expired", responded_at: nowIso })
    .eq("status", "offered")
    .lt("expires_at", nowIso);

  const { data: stuck } = await supabaseAdmin
    .from("rides")
    .select("id, requested_at")
    .eq("status", "searching")
    .lt("requested_at", new Date(Date.now() - 90_000).toISOString());

  for (const ride of stuck ?? []) {
    await supabaseAdmin
      .from("rides")
      .update({ status: "no_driver_found" })
      .eq("id", ride.id)
      .eq("status", "searching");
    await supabaseAdmin
      .from("ride_status_events")
      .insert({ ride_id: ride.id, status: "no_driver_found", actor_role: "system" });
  }
  const abandoned = await closeAbandonedRides();
  return { expiredRides: stuck?.length ?? 0, abandonedRides: abandoned };
}

/**
 * Closes trips that were never finished in the app. Without this a single
 * forgotten ride keeps its driver permanently "busy" and every new customer
 * request answers "no driver found".
 */
export async function closeAbandonedRides(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDONED_RIDE_MS).toISOString();
  const { data: rides } = await supabaseAdmin
    .from("rides")
    .select("id")
    .in("status", ["driver_assigned", "driver_arriving", "driver_arrived", "trip_started"])
    .lt("updated_at", cutoff);

  for (const ride of rides ?? []) {
    await supabaseAdmin
      .from("rides")
      .update({ status: "cancelled_by_system", cancellation_reason: "Abandoned trip closed automatically" })
      .eq("id", ride.id);
    await supabaseAdmin
      .from("ride_status_events")
      .insert({ ride_id: ride.id, status: "cancelled_by_system", actor_role: "system" });
  }
  return rides?.length ?? 0;
}

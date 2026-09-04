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
}

/** Approved, online, idle drivers of the right class who are not already engaged. */
async function eligibleDrivers(
  vehicleClass: string,
  cashRide: boolean,
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
  const busy = new Set(
    (
      await supabaseAdmin
        .from("rides")
        .select("driver_id")
        .in("status", ["driver_assigned", "driver_arriving", "driver_arrived", "trip_started"])
        .gt("updated_at", new Date(Date.now() - ABANDONED_RIDE_MS).toISOString())
    ).data?.map((row) => row.driver_id) ?? [],
  );

  // Concurrency: a driver holding a live offer for another request is not
  // offered a second one, so simultaneous bookings fan out to distinct drivers.
  const { data: pending } = await supabaseAdmin
    .from("driver_offers")
    .select("driver_id")
    .eq("status", "offered")
    .gt("expires_at", new Date().toISOString());
  for (const row of pending ?? []) busy.add(row.driver_id);

  const vehicleIds = (drivers ?? []).map((d) => d.active_vehicle_id).filter(Boolean) as string[];
  const { data: vehicles } = vehicleIds.length
    ? await supabaseAdmin.from("vehicles").select("id, vehicle_class, status").in("id", vehicleIds)
    : { data: [] };
  const vehicleMap = new Map((vehicles ?? []).map((v) => [v.id, v]));

  return (drivers ?? [])
    .filter((driver) => {
      if (busy.has(driver.id)) return false;
      if (cashRide && driver.cash_jobs_blocked) return false;
      if (driver.last_lat == null || driver.last_lng == null) return false;
      const vehicle = driver.active_vehicle_id ? vehicleMap.get(driver.active_vehicle_id) : null;
      return Boolean(vehicle && vehicle.status === "approved" && vehicle.vehicle_class === vehicleClass);
    })
    .map((driver) => ({
      driver_id: driver.id,
      vehicle_id: driver.active_vehicle_id as string,
      lat: Number(driver.last_lat),
      lng: Number(driver.last_lng),
    }));
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
  const drivers = await eligibleDrivers(vehicleClass, options.cashRide);
  const nearby = searchHexRings(pickup, drivers, radiusKm).slice(0, MAX_ROAD_LOOKUPS);
  if (nearby.length === 0) return { offers: 0, candidates: [] };

  // Rank the short list by how far the driver must actually drive on the road,
  // not by how the crow flies. Only the short list costs a provider call.
  const { getMapProvider } = await import("./adapters/map.server");
  const provider = getMapProvider();
  const ranked = await Promise.all(
    nearby.map(async (driver) => {
      try {
        const route = await provider.route({ lat: driver.lat, lng: driver.lng }, pickup);
        return {
          ...driver,
          road_km: Number(route.distance_km.toFixed(3)),
          eta_minutes: Number(route.duration_minutes.toFixed(1)),
        };
      } catch {
        return {
          ...driver,
          road_km: Number((driver.straight_km * 1.35).toFixed(3)),
          eta_minutes: Number((driver.straight_km * 2.8 + 1).toFixed(1)),
        };
      }
    }),
  );
  ranked.sort((a, b) => a.eta_minutes - b.eta_minutes || a.road_km - b.road_km);

  const best = ranked[0]!;
  const offerCount = best.road_km <= SOLO_OFFER_KM ? 1 : Math.min(ranked.length, TARGET_CANDIDATES);
  const candidates = ranked.slice(0, offerCount).map((driver) => ({
    driver_id: driver.driver_id,
    vehicle_id: driver.vehicle_id,
    distance_km: driver.road_km,
    eta_minutes: driver.eta_minutes,
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
      title: "New ride request",
      body: `A customer needs a taxi ${candidate.distance_km.toFixed(1)} km away (about ${Math.round(candidate.eta_minutes)} min).`,
      rideId,
      dedupeKey: `offer:${rideId}:${candidate.driver_id}`,
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
      .update({ status: "cancelled_system", cancellation_reason: "Abandoned trip closed automatically" })
      .eq("id", ride.id);
    await supabaseAdmin
      .from("ride_status_events")
      .insert({ ride_id: ride.id, status: "cancelled_system", actor_role: "system" });
  }
  return rides?.length ?? 0;
}

/** Server-only dispatch: eligible-driver search and offer creation. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { haversineKm } from "./geo";
import { notify } from "./notifications.server";

export interface DispatchResult {
  offers: number;
  candidates: { driver_id: string; distance_km: number; eta_minutes: number }[];
}

export async function dispatchRide(
  rideId: string,
  pickup: { lat: number; lng: number },
  vehicleClass: "boda" | "economy" | "comfort" | "xl",
  options: { radiusKm: number; offerTimeoutSeconds: number; cashRide: boolean },
): Promise<DispatchResult> {
  const { data: drivers } = await supabaseAdmin
    .from("drivers")
    .select("id, active_vehicle_id, last_lat, last_lng, last_location_at, cash_jobs_blocked, status, is_online")
    .eq("is_online", true)
    .eq("status", "approved")
    .not("active_vehicle_id", "is", null);

  const busy = new Set(
    (
      await supabaseAdmin
        .from("rides")
        .select("driver_id")
        .in("status", ["driver_assigned", "driver_arriving", "driver_arrived", "trip_started"])
    ).data?.map((row) => row.driver_id) ?? [],
  );

  const vehicleIds = (drivers ?? []).map((d) => d.active_vehicle_id).filter(Boolean) as string[];
  const { data: vehicles } = vehicleIds.length
    ? await supabaseAdmin
        .from("vehicles")
        .select("id, vehicle_class, status")
        .in("id", vehicleIds)
    : { data: [] };
  const vehicleMap = new Map((vehicles ?? []).map((v) => [v.id, v]));

  const candidates = (drivers ?? [])
    .filter((driver) => {
      if (busy.has(driver.id)) return false;
      if (options.cashRide && driver.cash_jobs_blocked) return false;
      if (driver.last_lat == null || driver.last_lng == null) return false;
      const vehicle = driver.active_vehicle_id ? vehicleMap.get(driver.active_vehicle_id) : null;
      if (!vehicle || vehicle.status !== "approved" || vehicle.vehicle_class !== vehicleClass) return false;
      return true;
    })
    .map((driver) => {
      const distance = haversineKm(pickup, {
        lat: Number(driver.last_lat),
        lng: Number(driver.last_lng),
      });
      return {
        driver_id: driver.id,
        vehicle_id: driver.active_vehicle_id as string,
        distance_km: Number(distance.toFixed(3)),
        eta_minutes: Number((distance * 2.8 + 1).toFixed(1)),
      };
    })
    .filter((candidate) => candidate.distance_km <= options.radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 5);

  if (candidates.length === 0) return { offers: 0, candidates: [] };

  const expiresAt = new Date(Date.now() + options.offerTimeoutSeconds * 1000).toISOString();
  await supabaseAdmin.from("driver_offers").insert(
    candidates.map((candidate) => ({
      ride_id: rideId,
      driver_id: candidate.driver_id,
      vehicle_id: candidate.vehicle_id,
      distance_km: candidate.distance_km,
      eta_minutes: candidate.eta_minutes,
      expires_at: expiresAt,
    })),
  );

  for (const candidate of candidates) {
    await notify({
      userId: candidate.driver_id,
      templateCode: "ride_offer",
      title: "New ride request",
      body: `A customer needs a taxi ${candidate.distance_km.toFixed(1)} km away.`,
      rideId,
      dedupeKey: `offer:${rideId}:${candidate.driver_id}`,
    });
  }

  return { offers: candidates.length, candidates };
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
  return { expiredRides: stuck?.length ?? 0 };
}

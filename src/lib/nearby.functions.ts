/**
 * Anonymised live supply near a pickup point.
 *
 * The customer sees which cars are genuinely available around them without
 * ever learning who those drivers are. Results are hex-limited to the dispatch
 * radius and cached briefly so scrolling the map cannot burn map-provider calls.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface NearbyDriver {
  lat: number;
  lng: number;
  vehicle_class: string;
  distance_km: number;
  eta_minutes: number;
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: NearbyDriver[] }>();

export const nearbyDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        vehicleClass: z.enum(["boda", "economy", "comfort", "xl"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ drivers: NearbyDriver[]; radiusKm: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { haversineKm } = await import("./geo");
    const { hexKey, hexOf } = await import("./hex");
    const { MAX_DISPATCH_RADIUS_KM } = await import("./dispatch.server");

    const pickup = { lat: data.lat, lng: data.lng };
    // Cache per hex, not per exact coordinate: tiny pin nudges reuse one result.
    const key = `${hexKey(hexOf(pickup))}:${data.vehicleClass ?? "all"}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { drivers: hit.value, radiusKm: MAX_DISPATCH_RADIUS_KM };
    }

    const { data: drivers } = await supabaseAdmin
      .from("drivers")
      .select("id, active_vehicle_id, last_lat, last_lng, last_location_at")
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
      ? await supabaseAdmin.from("vehicles").select("id, vehicle_class, status").in("id", vehicleIds)
      : { data: [] };
    const vehicleMap = new Map((vehicles ?? []).map((v) => [v.id, v]));

    const stale = Date.now() - 600_000;
    const result: NearbyDriver[] = [];
    for (const driver of drivers ?? []) {
      if (busy.has(driver.id)) continue;
      if (driver.last_lat == null || driver.last_lng == null) continue;
      if (driver.last_location_at && new Date(driver.last_location_at).getTime() < stale) continue;
      const vehicle = driver.active_vehicle_id ? vehicleMap.get(driver.active_vehicle_id) : null;
      if (!vehicle || vehicle.status !== "approved") continue;
      if (data.vehicleClass && vehicle.vehicle_class !== data.vehicleClass) continue;

      const point = { lat: Number(driver.last_lat), lng: Number(driver.last_lng) };
      const distance = haversineKm(pickup, point);
      if (distance > MAX_DISPATCH_RADIUS_KM) continue;

      result.push({
        // Coarsened to roughly 10 m so a car's exact doorstep is never exposed.
        lat: Number(point.lat.toFixed(4)),
        lng: Number(point.lng.toFixed(4)),
        vehicle_class: vehicle.vehicle_class,
        distance_km: Number(distance.toFixed(2)),
        eta_minutes: Number((distance * 2.8 + 1).toFixed(1)),
      });
    }

    result.sort((a, b) => a.distance_km - b.distance_km);
    const trimmed = result.slice(0, 12);
    cache.set(key, { at: Date.now(), value: trimmed });
    return { drivers: trimmed, radiusKm: MAX_DISPATCH_RADIUS_KM };
  });

/** Nearest available car per vehicle class, for the distant-pickup fee. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { haversineKm } from "./geo";
import { MAX_DISPATCH_RADIUS_KM } from "./dispatch.server";

export async function nearestDriverKmByClass(pickup: {
  lat: number;
  lng: number;
}): Promise<Map<string, number>> {
  const { data: drivers } = await supabaseAdmin
    .from("drivers")
    .select("id, active_vehicle_id, last_lat, last_lng, last_location_at")
    .eq("is_online", true)
    .eq("status", "approved")
    .not("active_vehicle_id", "is", null);
  const vehicleIds = (drivers ?? []).map((d) => d.active_vehicle_id).filter(Boolean) as string[];
  const { data: vehicles } = vehicleIds.length
    ? await supabaseAdmin.from("vehicles").select("id, vehicle_class, status").in("id", vehicleIds)
    : { data: [] };
  const vehicleMap = new Map((vehicles ?? []).map((v) => [v.id, v]));
  const stale = Date.now() - 600_000;
  const best = new Map<string, number>();
  for (const driver of drivers ?? []) {
    if (driver.last_lat == null || driver.last_lng == null) continue;
    if (driver.last_location_at && new Date(driver.last_location_at).getTime() < stale) continue;
    const vehicle = driver.active_vehicle_id ? vehicleMap.get(driver.active_vehicle_id) : null;
    if (!vehicle || vehicle.status !== "approved") continue;
    const km = haversineKm(pickup, { lat: Number(driver.last_lat), lng: Number(driver.last_lng) });
    if (km > MAX_DISPATCH_RADIUS_KM) continue;
    const prev = best.get(vehicle.vehicle_class);
    if (prev == null || km < prev) best.set(vehicle.vehicle_class, km);
  }
  return best;
}

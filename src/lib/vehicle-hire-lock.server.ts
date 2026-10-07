import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface HireWindow {
  vehicle_id: string;
  start_at: string;
  end_at: string | null;
  days: number;
}

const ACTIVE_RIDE_STATUSES = [
  "driver_assigned",
  "driver_arriving",
  "driver_arrived",
  "trip_started",
] as const;

function windowEnd(window: Pick<HireWindow, "start_at" | "end_at" | "days">) {
  return new Date(
    window.end_at ?? new Date(new Date(window.start_at).getTime() + window.days * 86_400_000),
  );
}

/** Confirmed hires only lock dispatch; pending/quoted dates are still held in the booking calendar. */
export async function activeHireWindows(
  vehicleIds: string[],
  at = new Date(),
): Promise<HireWindow[]> {
  const ids = [...new Set(vehicleIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const now = at.toISOString();
  const { data, error } = await supabaseAdmin
    .from("hire_quotes")
    .select("vehicle_id, start_at, end_at, days")
    .in("vehicle_id", ids)
    .eq("status", "confirmed")
    .lte("start_at", now)
    .or(`end_at.gte.${now},end_at.is.null`);
  if (error) throw new Error(`Could not check vehicle hire availability: ${error.message}`);
  return ((data ?? []) as unknown as HireWindow[]).filter(
    (row) => row.vehicle_id && windowEnd(row) > at,
  );
}

export async function activeHireForVehicle(vehicleId: string, at = new Date()) {
  return (await activeHireWindows([vehicleId], at))[0] ?? null;
}

/** Starts the hire on the driver's actual ride vehicle only when it has no live trip. */
export async function assertVehicleHasNoLiveRide(vehicleId: string, startsAt: Date) {
  if (startsAt.getTime() > Date.now()) return;
  const { data, error } = await supabaseAdmin
    .from("rides")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .in("status", [...ACTIVE_RIDE_STATUSES])
    .limit(1);
  if (error) throw new Error(`Could not verify vehicle ride status: ${error.message}`);
  if (data?.length)
    throw new Error(
      "This vehicle has an active ride. The hire cannot begin until the ride is complete.",
    );
}

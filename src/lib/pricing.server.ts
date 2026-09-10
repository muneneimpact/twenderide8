/** Server-only pricing loader: builds the authoritative snapshot used for a quote. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  ActiveModifier,
  DistancePolicy,
  FareConfig,
} from "./fare-engine";

export interface PricingContext {
  config: FareConfig;
  configId: string;
  policy: DistancePolicy | null;
  policyId: string | null;
  modifiers: ActiveModifier[];
  settings: Record<string, unknown>;
}

export async function loadSettings(): Promise<Record<string, unknown>> {
  const { data } = await supabaseAdmin.from("system_settings").select("key, value");
  const settings: Record<string, unknown> = {};
  for (const row of data ?? []) settings[row.key] = row.value;
  return settings;
}

export function settingNumber(
  settings: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = settings[key];
  const parsed = typeof value === "string" ? Number(value) : Number(value ?? NaN);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Night window and manual rain switch are evaluated in Africa/Nairobi time. */
function nairobiMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function inWindow(start: string | null, end: string | null, now: number): boolean {
  if (!start || !end) return false;
  const toMinutes = (value: string) => {
    const [h = "0", m = "0"] = value.split(":");
    return Number(h) * 60 + Number(m);
  };
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

export async function loadPricingContext(
  vehicleClass: "go" | "plus" | "comfort" | "xl" | "boda" | "e_boda",
  now = new Date(),
): Promise<PricingContext> {
  const settings = await loadSettings();

  const { data: configRow, error: configError } = await supabaseAdmin
    .from("fare_configs")
    .select("*")
    .eq("vehicle_class", vehicleClass)
    .eq("state", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (configError || !configRow) throw new Error("No published fare configuration for this vehicle class.");

  const config: FareConfig = {
    id: configRow.id,
    version: configRow.version,
    vehicle_class: configRow.vehicle_class,
    base_fare: Number(configRow.base_fare),
    per_km: Number(configRow.per_km),
    per_minute: Number(configRow.per_minute),
    minimum_fare: Number(configRow.minimum_fare),
    booking_fee: Number(configRow.booking_fee),
    waiting_per_minute: Number(configRow.waiting_per_minute),
    free_waiting_minutes: configRow.free_waiting_minutes,
    cancellation_fee: Number(configRow.cancellation_fee),
    cancellation_free_seconds: configRow.cancellation_free_seconds,
    commission_percent: Number(configRow.commission_percent),
    rounding_rule: configRow.rounding_rule as FareConfig["rounding_rule"],
    modifier_combination: configRow.modifier_combination as FareConfig["modifier_combination"],
    max_surcharge_percent: Number(configRow.max_surcharge_percent),
  };

  const { data: policyRow } = await supabaseAdmin
    .from("distance_policies")
    .select("id, name, version, max_total_reduction_percent")
    .eq("state", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let policy: DistancePolicy | null = null;
  if (policyRow) {
    const { data: bands } = await supabaseAdmin
      .from("distance_bands")
      .select("*")
      .eq("policy_id", policyRow.id)
      .order("sort_order");
    policy = {
      id: policyRow.id,
      name: policyRow.name,
      version: policyRow.version,
      max_total_reduction_percent: Number(policyRow.max_total_reduction_percent),
      bands: (bands ?? []).map((band) => ({
        sort_order: band.sort_order,
        admin_label: band.admin_label,
        customer_explanation: band.customer_explanation,
        lower_km: Number(band.lower_km),
        upper_km: band.upper_km === null ? null : Number(band.upper_km),
        start_reduction_percent: Number(band.start_reduction_percent),
        end_reduction_percent: Number(band.end_reduction_percent),
        mode: band.mode as "linear" | "fixed",
      })),
    };
  }

  const { data: modifierRows } = await supabaseAdmin
    .from("pricing_modifiers")
    .select("*")
    .eq("state", "published")
    .eq("active", true);

  const minutes = nairobiMinutes(now);
  const rainActive = String(settings["rain_modifier_active"] ?? "false") === "true";
  const modifiers: ActiveModifier[] = (modifierRows ?? [])
    .filter((row) => {
      if (row.vehicle_class && row.vehicle_class !== vehicleClass) return false;
      if (row.activation === "schedule") return inWindow(row.window_start, row.window_end, minutes);
      if (row.activation === "manual") return row.code === "rain" ? rainActive : true;
      if (row.activation === "provider") return false; // weather provider not connected
      return true;
    })
    .map((row) => ({
      code: row.code,
      customer_label: row.customer_label,
      explanation: row.explanation,
      percent: rampedPercent(row, minutes),
      applies_to_base: row.applies_to_base as ActiveModifier["applies_to_base"],
    }))
    .filter((modifier) => modifier.percent > 0);

  return {
    config,
    configId: configRow.id,
    policy,
    policyId: policyRow?.id ?? null,
    modifiers,
    settings,
  };
}

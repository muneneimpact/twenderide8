/**
 * Server-authoritative fare engine.
 *
 * Pure, deterministic, fixed-precision. The browser may render the itemised
 * result, but it never produces one that the platform trusts.
 */
import {
  applyRounding,
  divRound,
  maxUnits,
  minUnits,
  percentOf,
  SCALE,
  toAmount,
  toPrecise,
  units,
  type RoundingRule,
  type Units,
} from "./money";

export type BandMode = "linear" | "fixed";

export interface DistanceBand {
  sort_order: number;
  admin_label: string;
  customer_explanation?: string | null;
  lower_km: number;
  upper_km: number | null;
  start_reduction_percent: number;
  end_reduction_percent: number;
  mode: BandMode;
}

export interface DistancePolicy {
  id?: string;
  name: string;
  version: number;
  max_total_reduction_percent: number;
  bands: DistanceBand[];
}

export interface FareConfig {
  id?: string;
  version: number;
  vehicle_class: string;
  base_fare: number;
  per_km: number;
  per_minute: number;
  minimum_fare: number;
  booking_fee: number;
  waiting_per_minute: number;
  free_waiting_minutes: number;
  cancellation_fee: number;
  cancellation_free_seconds: number;
  commission_percent: number;
  rounding_rule: RoundingRule;
  modifier_combination: "additive" | "compounded";
  max_surcharge_percent: number;
}

export interface ActiveModifier {
  code: string;
  customer_label: string;
  explanation?: string | null;
  percent: number;
  applies_to_base: "distance_time" | "distance" | "subtotal";
}

export interface FareInput {
  distanceKm: number;
  durationMinutes: number;
  waitingMinutes?: number;
  config: FareConfig;
  policy?: DistancePolicy | null;
  modifiers: ActiveModifier[];
}

export interface BandBreakdown {
  label: string;
  explanation: string | null;
  lower_km: number;
  upper_km: number | null;
  used_km: number;
  mode: BandMode;
  start_reduction_percent: number;
  reduction_at_used_end_percent: number;
  average_reduction_percent: number;
  undiscounted_amount: number;
  saving: number;
  charge: number;
}

export interface ModifierBreakdown {
  code: string;
  label: string;
  explanation: string | null;
  percent: number;
  base: number;
  amount: number;
}

export interface FareBreakdown {
  currency: "KES";
  distance_km: number;
  duration_minutes: number;
  base_fare: number;
  booking_fee: number;
  distance_charge_undiscounted: number;
  long_distance_saving: number;
  distance_charge: number;
  time_charge: number;
  waiting_charge: number;
  bands: BandBreakdown[];
  modifiers: ModifierBreakdown[];
  modifier_total: number;
  subtotal: number;
  minimum_fare_applied: boolean;
  unrounded_total: number;
  rounding_rule: RoundingRule;
  total_fare: number;
  commission_percent: number;
  commission_amount: number;
  net_provider_earning: number;
}

function kmUnits(km: number): Units {
  return units(km.toFixed(3));
}

/**
 * Progressive marginal band pricing: kilometres already travelled keep their
 * earlier rate; only kilometres inside a band receive that band's reduction.
 */
export function computeDistanceCharge(
  distanceKm: number,
  perKm: number,
  policy: DistancePolicy | null | undefined,
): { undiscounted: Units; saving: Units; charge: Units; bands: BandBreakdown[] } {
  const rate = units(perKm);
  const distance = kmUnits(distanceKm);
  const undiscounted = divRound(distance * rate, SCALE);

  if (!policy || policy.bands.length === 0) {
    return { undiscounted, saving: 0n, charge: undiscounted, bands: [] };
  }

  const ordered = [...policy.bands].sort((a, b) => a.sort_order - b.sort_order);
  const breakdown: BandBreakdown[] = [];
  let totalSaving = 0n;

  for (const band of ordered) {
    const lower = kmUnits(band.lower_km);
    const upper = band.upper_km === null ? null : kmUnits(band.upper_km);
    const span = upper === null ? null : upper - lower;
    const rawUsed = distance - lower;
    if (rawUsed <= 0n) continue;
    const usedKm = span === null ? rawUsed : minUnits(rawUsed, span);
    if (usedKm <= 0n) continue;

    const start = units(band.start_reduction_percent);
    const end = units(band.end_reduction_percent);

    let reductionAtUsedEnd: Units;
    if (band.mode === "fixed" || span === null || span === 0n) {
      reductionAtUsedEnd = start;
    } else {
      reductionAtUsedEnd = start + divRound((end - start) * usedKm, span);
    }
    const averageReduction =
      band.mode === "fixed" ? start : divRound(start + reductionAtUsedEnd, 2n);

    const undiscountedBand = divRound(usedKm * rate, SCALE);
    const saving = divRound(undiscountedBand * averageReduction, 100n * SCALE);
    totalSaving += saving;

    breakdown.push({
      label: band.admin_label,
      explanation: band.customer_explanation ?? null,
      lower_km: band.lower_km,
      upper_km: band.upper_km,
      used_km: toPrecise(usedKm),
      mode: band.mode,
      start_reduction_percent: band.start_reduction_percent,
      reduction_at_used_end_percent: toPrecise(reductionAtUsedEnd),
      average_reduction_percent: toPrecise(averageReduction),
      undiscounted_amount: toAmount(undiscountedBand),
      saving: toAmount(saving),
      charge: toAmount(undiscountedBand - saving),
    });
  }

  // Global reduction cap: total saving can never exceed the configured maximum.
  const cap = percentOf(undiscounted, policy.max_total_reduction_percent);
  const saving = minUnits(totalSaving, cap);
  const charge = maxUnits(undiscounted - saving, 0n);
  return { undiscounted, saving, charge, bands: breakdown };
}

export function computeFare(input: FareInput): FareBreakdown {
  const { config, policy, modifiers } = input;
  if (input.distanceKm < 0 || input.durationMinutes < 0) {
    throw new Error("Route distance and duration must be positive");
  }

  const distanceResult = computeDistanceCharge(input.distanceKm, config.per_km, policy ?? null);
  const baseFare = units(config.base_fare);
  const bookingFee = units(config.booking_fee);
  const timeCharge = divRound(
    units(input.durationMinutes.toFixed(3)) * units(config.per_minute),
    SCALE,
  );
  const billableWaiting = Math.max(0, (input.waitingMinutes ?? 0) - config.free_waiting_minutes);
  const waitingCharge = divRound(
    units(billableWaiting.toFixed(3)) * units(config.waiting_per_minute),
    SCALE,
  );

  const subtotalBeforeModifiers =
    baseFare + bookingFee + distanceResult.charge + timeCharge + waitingCharge;

  const modifierBreakdown: ModifierBreakdown[] = [];
  let modifierTotal = 0n;

  const baseFor = (kind: ActiveModifier["applies_to_base"]): Units => {
    if (kind === "distance") return distanceResult.charge;
    if (kind === "distance_time") return distanceResult.charge + timeCharge;
    return subtotalBeforeModifiers;
  };

  if (config.modifier_combination === "additive") {
    for (const modifier of modifiers) {
      const base = baseFor(modifier.applies_to_base);
      const amount = percentOf(base, modifier.percent);
      modifierTotal += amount;
      modifierBreakdown.push({
        code: modifier.code,
        label: modifier.customer_label,
        explanation: modifier.explanation ?? null,
        percent: modifier.percent,
        base: toAmount(base),
        amount: toAmount(amount),
      });
    }
  } else {
    // Compounded: each modifier applies to the base already grown by earlier ones.
    let grown = new Map<ActiveModifier["applies_to_base"], Units>();
    for (const modifier of modifiers) {
      const originalBase = baseFor(modifier.applies_to_base);
      const currentBase = grown.get(modifier.applies_to_base) ?? originalBase;
      const amount = percentOf(currentBase, modifier.percent);
      grown.set(modifier.applies_to_base, currentBase + amount);
      modifierTotal += amount;
      modifierBreakdown.push({
        code: modifier.code,
        label: modifier.customer_label,
        explanation: modifier.explanation ?? null,
        percent: modifier.percent,
        base: toAmount(currentBase),
        amount: toAmount(amount),
      });
    }
  }

  // Surcharge cap protects customers from stacked modifiers.
  const surchargeCap = percentOf(subtotalBeforeModifiers, config.max_surcharge_percent);
  if (modifierTotal > surchargeCap) modifierTotal = surchargeCap;

  let unrounded = subtotalBeforeModifiers + modifierTotal;
  const minimumFare = units(config.minimum_fare);
  const minimumApplied = unrounded < minimumFare;
  if (minimumApplied) unrounded = minimumFare;

  const total = applyRounding(unrounded, config.rounding_rule);
  const commission = percentOf(total, config.commission_percent);

  return {
    currency: "KES",
    distance_km: input.distanceKm,
    duration_minutes: input.durationMinutes,
    base_fare: toAmount(baseFare),
    booking_fee: toAmount(bookingFee),
    distance_charge_undiscounted: toAmount(distanceResult.undiscounted),
    long_distance_saving: toAmount(distanceResult.saving),
    distance_charge: toAmount(distanceResult.charge),
    time_charge: toAmount(timeCharge),
    waiting_charge: toAmount(waitingCharge),
    bands: distanceResult.bands,
    modifiers: modifierBreakdown,
    modifier_total: toAmount(modifierTotal),
    subtotal: toAmount(subtotalBeforeModifiers),
    minimum_fare_applied: minimumApplied,
    unrounded_total: toPrecise(unrounded),
    rounding_rule: config.rounding_rule,
    total_fare: toAmount(total),
    commission_percent: config.commission_percent,
    commission_amount: toAmount(commission),
    net_provider_earning: toAmount(total - commission),
  };
}

export interface BandValidationIssue {
  band?: string;
  message: string;
}

/** Publication gate for a long-distance reduction policy. */
export function validateDistancePolicy(
  policy: DistancePolicy,
  perKm = 78,
): BandValidationIssue[] {
  const issues: BandValidationIssue[] = [];
  const bands = [...policy.bands].sort((a, b) => a.sort_order - b.sort_order);
  if (bands.length === 0) return [{ message: "Add at least one distance band." }];

  bands.forEach((band, index) => {
    if (band.upper_km !== null && band.upper_km <= band.lower_km) {
      issues.push({ band: band.admin_label, message: "Upper threshold must exceed the lower threshold." });
    }
    for (const value of [band.start_reduction_percent, band.end_reduction_percent]) {
      if (value < 0 || value >= 100) {
        issues.push({ band: band.admin_label, message: "Reductions must be at least 0% and below 100%." });
      }
    }
    if (band.upper_km === null && band.mode !== "fixed") {
      issues.push({ band: band.admin_label, message: "An open-ended final band must use a fixed reduction." });
    }
    if (band.upper_km === null && index !== bands.length - 1) {
      issues.push({ band: band.admin_label, message: "Only the final band may be open-ended." });
    }
    const previous = bands[index - 1];
    if (previous) {
      if (previous.upper_km === null) return;
      if (Math.abs(previous.upper_km - band.lower_km) > 0.0001) {
        issues.push({ band: band.admin_label, message: "Bands must be continuous with no gap or overlap." });
      }
      const previousEnd =
        previous.mode === "fixed" ? previous.start_reduction_percent : previous.end_reduction_percent;
      if (Math.abs(previousEnd - band.start_reduction_percent) > 0.0001) {
        issues.push({
          band: band.admin_label,
          message: "This band must begin at the previous band's ending reduction.",
        });
      }
    } else if (Math.abs(band.lower_km) > 0.0001) {
      issues.push({ band: band.admin_label, message: "The first band must start at 0 km." });
    }
  });

  if (policy.max_total_reduction_percent < 0 || policy.max_total_reduction_percent >= 100) {
    issues.push({ message: "The global reduction cap must be below 100%." });
  }

  // Monotonicity: total distance charge must never fall as distance grows.
  let previousCharge = -1;
  const boundaries = new Set<number>([0.5, 1, 2.4, 5]);
  for (const band of bands) {
    boundaries.add(band.lower_km);
    if (band.upper_km !== null) {
      boundaries.add(band.upper_km);
      boundaries.add(Math.max(0, band.upper_km - 0.01));
      boundaries.add(band.upper_km + 0.01);
    } else {
      boundaries.add(band.lower_km + 10);
      boundaries.add(band.lower_km + 50);
    }
  }
  for (const distance of [...boundaries].sort((a, b) => a - b)) {
    const { charge } = computeDistanceCharge(distance, perKm, policy);
    const value = toAmount(charge);
    if (value + 0.0001 < previousCharge) {
      issues.push({
        message: `Fare falls at ${distance} km — a longer trip must never cost less.`,
      });
    }
    previousCharge = value;
  }

  return issues;
}

export interface PreviewRow {
  distance_km: number;
  undiscounted: number;
  saving: number;
  adjusted: number;
  modifiers: number;
  total: number;
}

export function previewTable(
  config: FareConfig,
  policy: DistancePolicy | null,
  modifiers: ActiveModifier[],
  distances: number[],
): PreviewRow[] {
  return distances.map((distanceKm) => {
    const breakdown = computeFare({
      distanceKm,
      durationMinutes: distanceKm * 2.5,
      config,
      policy,
      modifiers,
    });
    return {
      distance_km: distanceKm,
      undiscounted: breakdown.distance_charge_undiscounted,
      saving: breakdown.long_distance_saving,
      adjusted: breakdown.distance_charge,
      modifiers: breakdown.modifier_total,
      total: breakdown.total_fare,
    };
  });
}

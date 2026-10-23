/**
 * Distant-pickup approach fee. When the nearest car is more than 500 m away the
 * customer pays an Ops-configurable share of the driver's estimated trip cost
 * to reach them. The share tapers between the configured short and long rates.
 * The whole fee goes to the driver.
 */
export const APPROACH_FREE_KM = 0.5;
const SHORT_LIMIT_KM = 1.5;
const LONG_FROM_KM = 5;
const SHORT_PERCENT = 50;
const LONG_PERCENT = 30;

export function approachPercent(
  distanceKm: number,
  shortPercent = SHORT_PERCENT,
  longPercent = LONG_PERCENT,
): number {
  const short = Math.min(100, Math.max(0, shortPercent));
  const long = Math.min(100, Math.max(0, longPercent));
  if (distanceKm <= APPROACH_FREE_KM) return 0;
  if (distanceKm <= SHORT_LIMIT_KM) return short;
  if (distanceKm >= LONG_FROM_KM) return long;
  const t = (distanceKm - SHORT_LIMIT_KM) / (LONG_FROM_KM - SHORT_LIMIT_KM);
  return Math.round(short - t * (short - long));
}

export function computeApproachFee(
  distanceKm: number | null,
  perKm: number,
  percentages: { shortPercent?: number; longPercent?: number } = {},
) {
  if (distanceKm == null || distanceKm <= APPROACH_FREE_KM) {
    return { fee: 0, percent: 0, distance_km: distanceKm ?? 0 };
  }
  const percent = approachPercent(
    distanceKm,
    percentages.shortPercent,
    percentages.longPercent,
  );
  const fee = Math.ceil((distanceKm * perKm * percent) / 100);
  return { fee, percent, distance_km: Number(distanceKm.toFixed(2)) };
}

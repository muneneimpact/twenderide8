/**
 * Distant-pickup approach fee. When the nearest car is more than 500 m away the
 * customer pays part of the driver's trip to reach them: 50% of the per-km rate
 * for short approaches, sliding down to 30% for the longest ones. The whole fee
 * goes to the driver.
 */
export const APPROACH_FREE_KM = 0.5;
const SHORT_LIMIT_KM = 1.5;
const LONG_FROM_KM = 5;
const SHORT_PERCENT = 50;
const LONG_PERCENT = 30;

export function approachPercent(distanceKm: number): number {
  if (distanceKm <= APPROACH_FREE_KM) return 0;
  if (distanceKm <= SHORT_LIMIT_KM) return SHORT_PERCENT;
  if (distanceKm >= LONG_FROM_KM) return LONG_PERCENT;
  const t = (distanceKm - SHORT_LIMIT_KM) / (LONG_FROM_KM - SHORT_LIMIT_KM);
  return Math.round(SHORT_PERCENT - t * (SHORT_PERCENT - LONG_PERCENT));
}

export function computeApproachFee(distanceKm: number | null, perKm: number) {
  if (distanceKm == null || distanceKm <= APPROACH_FREE_KM) {
    return { fee: 0, percent: 0, distance_km: distanceKm ?? 0 };
  }
  const percent = approachPercent(distanceKm);
  const fee = Math.ceil((distanceKm * perKm * percent) / 100);
  return { fee, percent, distance_km: Number(distanceKm.toFixed(2)) };
}

/**
 * Rating-aware dispatch order. Closeness still wins: a top-rated driver only
 * jumps ahead when they are within a few minutes of a lower-rated one.
 */
export const RATING_MINUTES_PER_STAR = 2;
export const NEUTRAL_RATING = 4.5;
/** New drivers with few trips are treated as neutral so they still get work. */
export const MIN_RATED_TRIPS = 5;

export function effectiveEta(etaMinutes: number, rating: number | null | undefined, completedRides = 0): number {
  const r = completedRides < MIN_RATED_TRIPS || !rating ? NEUTRAL_RATING : Math.max(1, Math.min(5, rating));
  return etaMinutes - (r - NEUTRAL_RATING) * RATING_MINUTES_PER_STAR;
}

export function rankByEtaAndRating<T extends { eta_minutes: number; road_km: number; rating?: number | null; completed_rides?: number }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      effectiveEta(a.eta_minutes, a.rating, a.completed_rides) - effectiveEta(b.eta_minutes, b.rating, b.completed_rides) ||
      a.road_km - b.road_km,
  );
}

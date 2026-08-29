/**
 * Lightweight hexagonal spatial index used by dispatch.
 *
 * Drivers are binned into pointy-top hexagons of a fixed size around a local
 * origin. Searching a pickup means walking outward ring by ring and stopping
 * as soon as enough nearby drivers are found, so a busy city centre never
 * scans (or pays map-provider calls for) drivers on the far side of town.
 */
import type { LatLng } from "./geo";
import { MERU_CENTRE } from "./geo";

export const HEX_SIZE_KM = 1.2;

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

export interface Hex {
  q: number;
  r: number;
}

function axialRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function hexOf(point: LatLng, origin: LatLng = MERU_CENTRE, sizeKm = HEX_SIZE_KM): Hex {
  const x = (point.lng - origin.lng) * kmPerDegLng(origin.lat);
  const y = (point.lat - origin.lat) * KM_PER_DEG_LAT;
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / sizeKm;
  const r = ((2 / 3) * y) / sizeKm;
  return axialRound(q, r);
}

export function hexKey(hex: Hex): string {
  return `${hex.q}:${hex.r}`;
}

export function hexDistance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** All hexes exactly `radius` rings away from the centre (radius 0 = centre). */
export function hexRing(centre: Hex, radius: number): Hex[] {
  if (radius <= 0) return [centre];
  const directions: Hex[] = [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
  ];
  const results: Hex[] = [];
  let hex: Hex = { q: centre.q + directions[4]!.q * radius, r: centre.r + directions[4]!.r * radius };
  for (let side = 0; side < 6; side += 1) {
    for (let step = 0; step < radius; step += 1) {
      results.push(hex);
      const dir = directions[side]!;
      hex = { q: hex.q + dir.q, r: hex.r + dir.r };
    }
  }
  return results;
}

/** How many rings are needed to cover a straight-line radius in kilometres. */
export function ringsWithin(radiusKm: number, sizeKm = HEX_SIZE_KM): number {
  return Math.max(1, Math.ceil(radiusKm / (sizeKm * 1.5)) + 1);
}

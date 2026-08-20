export interface LatLng {
  lat: number;
  lng: number;
}

export const MERU_CENTRE: LatLng = { lat: 0.047, lng: 37.65 };

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type AccuracyBand = "high" | "approximate" | "low";

export function accuracyBand(accuracyMetres: number | null | undefined): AccuracyBand {
  if (accuracyMetres == null) return "low";
  if (accuracyMetres <= 20) return "high";
  if (accuracyMetres <= 100) return "approximate";
  return "low";
}

export function accuracyLabel(accuracyMetres: number | null | undefined): string {
  const band = accuracyBand(accuracyMetres);
  if (band === "high") return `Good accuracy (±${Math.round(accuracyMetres ?? 0)} m)`;
  if (band === "approximate") return `Approximate location (±${Math.round(accuracyMetres ?? 0)} m)`;
  return accuracyMetres == null
    ? "Location accuracy unknown — drag the pin to fine-tune"
    : `Weak GPS signal (±${Math.round(accuracyMetres)} m) — drag the pin to fine-tune`;
}

export type Freshness = "live" | "recent" | "stale" | "unavailable";

export function freshness(timestamp: string | null | undefined, now = Date.now()): Freshness {
  if (!timestamp) return "unavailable";
  const age = (now - new Date(timestamp).getTime()) / 1000;
  if (age <= 20) return "live";
  if (age <= 60) return "recent";
  if (age <= 600) return "stale";
  return "unavailable";
}

export function freshnessLabel(timestamp: string | null | undefined, now = Date.now()): string {
  const state = freshness(timestamp, now);
  if (state === "unavailable") return "Driver location unavailable";
  const seconds = Math.round((now - new Date(timestamp!).getTime()) / 1000);
  if (state === "live") return "Live";
  if (state === "recent") return `Updated ${seconds}s ago`;
  return `Last updated ${Math.round(seconds / 60)} min ago — not live`;
}

export function nairobiTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function nairobiClock(value: string | Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    timeStyle: "short",
  }).format(typeof value === "string" ? new Date(value) : value);
}

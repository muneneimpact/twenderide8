/**
 * Map provider adapter (server-only).
 *
 * The production provider has not been supplied yet. The default adapter uses
 * open routing/geocoding services so precise pins, routes, and traffic-free
 * durations work today; swapping to a paid provider only requires another
 * implementation of MapProvider.
 */
import type { LatLng } from "../geo";
import { haversineKm, MERU_CENTRE } from "../geo";

export interface RouteResult {
  provider: string;
  distance_km: number;
  duration_minutes: number;
  traffic_aware: boolean;
  polyline: string | null;
  raw: unknown;
}

export interface PlaceResult {
  label: string;
  address: string;
  lat: number;
  lng: number;
  kind: string;
}

export interface MapProvider {
  name: string;
  route(from: LatLng, to: LatLng): Promise<RouteResult>;
  search(query: string, near?: LatLng): Promise<PlaceResult[]>;
  reverse(point: LatLng): Promise<PlaceResult | null>;
}

const USER_AGENT = "TwendeRide/1.0 (Meru, Kenya)";

/** Straight-line fallback so a provider outage never blocks a quote silently. */
function estimateRoute(from: LatLng, to: LatLng): RouteResult {
  const straight = haversineKm(from, to);
  const distance = Number((straight * 1.35).toFixed(3));
  return {
    provider: "estimate",
    distance_km: distance,
    duration_minutes: Number((distance * 2.6).toFixed(2)),
    traffic_aware: false,
    polyline: null,
    raw: { note: "Straight-line estimate used because the route provider was unreachable." },
  };
}

export const openMapProvider: MapProvider = {
  name: "osm",
  async route(from, to) {
    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline`;
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) return estimateRoute(from, to);
      const body = (await response.json()) as {
        routes?: { distance: number; duration: number; geometry?: string }[];
      };
      const route = body.routes?.[0];
      if (!route) return estimateRoute(from, to);
      return {
        provider: "osrm",
        distance_km: Number((route.distance / 1000).toFixed(3)),
        duration_minutes: Number((route.duration / 60).toFixed(2)),
        traffic_aware: false,
        polyline: route.geometry ?? null,
        raw: { distance: route.distance, duration: route.duration },
      };
    } catch {
      return estimateRoute(from, to);
    }
  },
  async search(query, near = MERU_CENTRE) {
    if (query.trim().length < 3) return [];
    const viewbox = `${near.lng - 0.6},${near.lat + 0.6},${near.lng + 0.6},${near.lat - 0.6}`;
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8` +
      `&countrycodes=ke&viewbox=${viewbox}&bounded=0&q=${encodeURIComponent(query)}`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        display_name: string;
        name?: string;
        lat: string;
        lon: string;
        type?: string;
        category?: string;
      }[];
      return body
        .map((item) => ({
          label: item.name && item.name.length > 0 ? item.name : item.display_name.split(",")[0]!,
          address: item.display_name,
          lat: Number(item.lat),
          lng: Number(item.lon),
          kind: item.category ?? item.type ?? "place",
        }))
        .sort(
          (a, b) =>
            haversineKm(near, { lat: a.lat, lng: a.lng }) -
            haversineKm(near, { lat: b.lat, lng: b.lng }),
        );
    } catch {
      return [];
    }
  },
  async reverse(point) {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1` +
      `&lat=${point.lat}&lon=${point.lng}`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) return null;
      const item = (await response.json()) as { display_name?: string; name?: string };
      if (!item.display_name) return null;
      return {
        label: item.name && item.name.length > 0 ? item.name : item.display_name.split(",")[0]!,
        address: item.display_name,
        lat: point.lat,
        lng: point.lng,
        kind: "reverse",
      };
    } catch {
      return null;
    }
  },
};

export function getMapProvider(): MapProvider {
  // A commercial provider key would be read here from process.env inside the
  // calling handler and returned as an alternative implementation.
  return openMapProvider;
}

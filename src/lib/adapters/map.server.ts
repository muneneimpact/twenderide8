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

/**
 * Look for a named place within a short walk of the pin (hotel, shop, fuel
 * station, school…) so the pickup reads like a landmark instead of the town.
 */
async function nearestLandmark(point: LatLng): Promise<PlaceResult | null> {
  const query =
    `[out:json][timeout:8];(` +
    `node(around:150,${point.lat},${point.lng})["name"]["amenity"];` +
    `node(around:150,${point.lat},${point.lng})["name"]["shop"];` +
    `node(around:150,${point.lat},${point.lng})["name"]["tourism"];` +
    `way(around:150,${point.lat},${point.lng})["name"]["building"~"commercial|retail|hotel|hospital|school"];` +
    `);out center 12;`;
  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      elements?: {
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }[];
    };
    const candidates = (body.elements ?? [])
      .map((element) => {
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        const name = element.tags?.["name"];
        if (lat == null || lon == null || !name) return null;
        const kind =
          element.tags?.["amenity"] ?? element.tags?.["shop"] ?? element.tags?.["tourism"] ?? "place";
        return { name, kind, lat, lon, distance: haversineKm(point, { lat, lng: lon }) };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((a, b) => a.distance - b.distance);

    const best = candidates[0];
    if (!best) return null;
    const metres = Math.round(best.distance * 1000);
    return {
      label: metres <= 25 ? best.name : `Near ${best.name}`,
      address: `${best.name} (${best.kind.replace(/_/g, " ")}) · about ${metres} m away`,
      lat: point.lat,
      lng: point.lng,
      kind: "landmark",
    };
  } catch {
    return null;
  }
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
    // A pin should read like a place you'd tell a driver — a hotel, shop,
    // petrol station or road — not just the town name.
    const landmark = await nearestLandmark(point);
    if (landmark) return landmark;

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1` +
      `&lat=${point.lat}&lon=${point.lng}`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) return null;
      const item = (await response.json()) as {
        display_name?: string;
        name?: string;
        address?: Record<string, string>;
      };
      if (!item.display_name) return null;
      const a = item.address ?? {};
      const specific =
        (item.name && item.name.length > 0 ? item.name : null) ??
        a["amenity"] ??
        a["shop"] ??
        a["tourism"] ??
        a["building"] ??
        a["office"] ??
        a["leisure"] ??
        a["road"] ??
        a["neighbourhood"] ??
        a["suburb"] ??
        item.display_name.split(",")[0]!;
      const context = a["road"] && specific !== a["road"] ? `${specific}, ${a["road"]}` : specific;
      return {
        label: context,
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

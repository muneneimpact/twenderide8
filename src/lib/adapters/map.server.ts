/**
 * Map provider adapter (server-only).
 *
 * Production provider: Google Maps Platform, reached through the Lovable
 * connector gateway (Routes API, Places API New, Geocoding API). If the
 * gateway or credentials are unavailable the adapter degrades to a
 * straight-line estimate rather than failing a quote silently.
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

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

function credentials() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) return null;
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": mapsKey,
  } satisfies Record<string, string>;
}

/** Surfaces the exact Google key restriction problem instead of a bare 500. */
async function describeFailure(response: Response): Promise<string> {
  const body = await response.text();
  if (response.status === 403) {
    try {
      const details: Array<{ reason?: string }> =
        (JSON.parse(body) as { error?: { details?: Array<{ reason?: string }> } }).error?.details ??
        [];
      const reason = details.find((detail) => detail.reason)?.reason;
      if (reason === "API_KEY_HTTP_REFERRER_BLOCKED") {
        return 'Google Maps server key is referrer-restricted. Set its application restrictions to "None" or "IP addresses".';
      }
      if (reason === "API_KEY_SERVICE_BLOCKED") {
        return "Google Maps server key does not allow this API. Add it to the key's allowed-APIs list.";
      }
    } catch {
      /* fall through to the generic message */
    }
  }
  return `Google Maps request failed [${response.status}]: ${body.slice(0, 300)}`;
}

/** Straight-line fallback so a provider outage never blocks a quote silently. */
function estimateRoute(from: LatLng, to: LatLng, note: string): RouteResult {
  const straight = haversineKm(from, to);
  const distance = Number((straight * 1.35).toFixed(3));
  return {
    provider: "estimate",
    distance_km: distance,
    duration_minutes: Number((distance * 2.6).toFixed(2)),
    traffic_aware: false,
    polyline: null,
    raw: { note },
  };
}

export const googleMapProvider: MapProvider = {
  name: "google",
  async route(from, to) {
    const headers = credentials();
    if (!headers) {
      return estimateRoute(from, to, "Google Maps credentials are not configured.");
    }
    try {
      const response = await fetch(`${GATEWAY_URL}/routes/directions/v2:computeRoutes`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Goog-FieldMask":
            "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          polylineEncoding: "ENCODED_POLYLINE",
          regionCode: "KE",
        }),
      });
      if (!response.ok) {
        return estimateRoute(from, to, await describeFailure(response));
      }
      const body = (await response.json()) as {
        routes?: {
          distanceMeters?: number;
          duration?: string;
          polyline?: { encodedPolyline?: string };
        }[];
      };
      const route = body.routes?.[0];
      if (!route?.distanceMeters) {
        return estimateRoute(from, to, "Google returned no drivable route.");
      }
      const seconds = Number(String(route.duration ?? "0s").replace("s", ""));
      return {
        provider: "google-routes",
        distance_km: Number((route.distanceMeters / 1000).toFixed(3)),
        duration_minutes: Number((seconds / 60).toFixed(2)),
        traffic_aware: true,
        polyline: route.polyline?.encodedPolyline ?? null,
        raw: { distanceMeters: route.distanceMeters, duration: route.duration },
      };
    } catch {
      return estimateRoute(from, to, "Google Maps was unreachable.");
    }
  },

  async search(query, near = MERU_CENTRE) {
    if (query.trim().length < 2) return [];
    const headers = credentials();
    if (!headers) return [];
    try {
      const response = await fetch(`${GATEWAY_URL}/places/v1/places:searchText`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location,places.primaryType",
        },
        body: JSON.stringify({
          textQuery: query,
          regionCode: "KE",
          maxResultCount: 8,
          locationBias: {
            circle: {
              center: { latitude: near.lat, longitude: near.lng },
              radius: 50000,
            },
          },
        }),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        places?: {
          displayName?: { text?: string };
          formattedAddress?: string;
          location?: { latitude: number; longitude: number };
          primaryType?: string;
        }[];
      };
      return (body.places ?? [])
        .map((item) => {
          const lat = item.location?.latitude;
          const lng = item.location?.longitude;
          if (lat == null || lng == null) return null;
          return {
            label: item.displayName?.text ?? item.formattedAddress ?? "Selected place",
            address: item.formattedAddress ?? item.displayName?.text ?? "",
            lat,
            lng,
            kind: item.primaryType ?? "place",
          } satisfies PlaceResult;
        })
        // Google's own ranking already blends relevance with the location bias.
        // Re-sorting by distance moved the exact typed match down the list, so
        // people tapped a nearby place instead of the one they searched for.
        .filter((value): value is PlaceResult => value !== null);
    } catch {
      return [];
    }
  },

  async reverse(point) {
    const headers = credentials();
    if (!headers) return null;

    // A pin should read like a place you'd tell a driver — a hotel, shop or
    // road — so we try the nearest named place before the street address.
    try {
      const nearby = await fetch(`${GATEWAY_URL}/places/v1/places:searchNearby`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify({
          maxResultCount: 3,
          rankPreference: "DISTANCE",
          locationRestriction: {
            circle: { center: { latitude: point.lat, longitude: point.lng }, radius: 200 },
          },
        }),
      });
      if (nearby.ok) {
        const body = (await nearby.json()) as {
          places?: {
            displayName?: { text?: string };
            formattedAddress?: string;
            location?: { latitude: number; longitude: number };
          }[];
        };
        const best = body.places?.[0];
        const name = best?.displayName?.text;
        if (best && name) {
          const lat = best.location?.latitude ?? point.lat;
          const lng = best.location?.longitude ?? point.lng;
          const metres = Math.round(haversineKm(point, { lat, lng }) * 1000);
          return {
            label: metres <= 30 ? name : `Near ${name}`,
            address: best.formattedAddress ?? `${name} · about ${metres} m away`,
            lat: point.lat,
            lng: point.lng,
            kind: "landmark",
          };
        }
      }
    } catch {
      /* fall back to geocoding below */
    }

    try {
      const response = await fetch(
        `${GATEWAY_URL}/maps/api/geocode/json?latlng=${point.lat},${point.lng}&region=ke`,
        { headers },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        results?: { formatted_address?: string; address_components?: { long_name: string }[] }[];
      };
      const first = body.results?.[0];
      if (!first?.formatted_address) return null;
      return {
        label: first.address_components?.[0]?.long_name ?? first.formatted_address.split(",")[0]!,
        address: first.formatted_address,
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
  return googleMapProvider;
}

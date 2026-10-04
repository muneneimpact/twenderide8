import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { decodePolyline } from "@/lib/polyline";

export interface MapPoint {
  lat: number;
  lng: number;
}

interface TwendeMapProps {
  pickup: MapPoint | null;
  dropoff: MapPoint | null;
  driver?: (MapPoint & { accuracy_m?: number | null }) | null;
  /** Anonymised nearby drivers who are online and free, drawn as small cars. */
  nearbyDrivers?: Array<MapPoint & { eta_minutes?: number | null }>;
  /** Encoded road route between pickup and dropoff, when the router returned one. */
  polyline?: string | null;
  /** Which pin the user is currently placing; tapping the map moves it. */
  placing?: "pickup" | "dropoff" | null;
  onPlace?: (point: MapPoint) => void;
  className?: string;
}



const MERU: MapPoint = { lat: 0.0471, lng: 37.6497 };

function pinIcon(maps: typeof google.maps, colour: string): google.maps.Symbol {
  return {
    path: maps.SymbolPath.CIRCLE,
    scale: 8,
    fillColor: colour,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
  };
}

export default function TwendeMap({
  pickup,
  dropoff,
  driver,
  nearbyDrivers,
  polyline,
  placing,
  onPlace,
  className,
}: TwendeMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const mapsApi = useRef<typeof google.maps | null>(null);
  const overlays = useRef<Array<{ setMap: (m: google.maps.Map | null) => void }>>([]);
  const place = useRef(onPlace);
  const mode = useRef(placing);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  place.current = onPlace;
  mode.current = placing;

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !holder.current || map.current) return;
        const instance = new maps.Map(holder.current, {
          center: { lat: pickup?.lat ?? MERU.lat, lng: pickup?.lng ?? MERU.lng },
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        instance.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (!mode.current || !event.latLng) return;
          place.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        });
        mapsApi.current = maps;
        map.current = instance;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map.current = null;
      mapsApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    const maps = mapsApi.current;
    if (!instance || !maps || !ready) return;

    overlays.current.forEach((overlay) => overlay.setMap(null));
    overlays.current = [];
    const points: MapPoint[] = [];

    const addMarker = (point: MapPoint, colour: string, label: string) => {
      const marker = new maps.Marker({
        position: point,
        map: instance,
        icon: pinIcon(maps, colour),
        title: label,
        label: {
          text: label,
          className: "twende-map-label",
          color: colour,
          fontSize: "11px",
          fontWeight: "700",
        },
      });
      overlays.current.push(marker);
    };

    if (pickup) {
      addMarker(pickup, "#1f6f4a", "Pickup");
      points.push(pickup);
    }
    if (dropoff) {
      addMarker(dropoff, "#8a5a12", "Destination");
      points.push(dropoff);
    }
    if (pickup && dropoff) {
      // A road route may still be loading or unavailable. Never suggest that a
      // direct line between the pins is a drivable road.
      const road = polyline ? decodePolyline(polyline) : [];
      if (road.length > 1) {
        const line = new maps.Polyline({
          path: road,
          map: instance,
          strokeColor: "#1f6f4a",
          strokeOpacity: 0.95,
          strokeWeight: 5,
        });
        overlays.current.push(line);
        road.forEach((point) => points.push(point));
      }
    }
    if (driver) {
      addMarker(driver, "#0f4c81", "Driver");
      if (driver.accuracy_m) {
        const halo = new maps.Circle({
          center: driver,
          radius: Math.min(driver.accuracy_m, 500),
          map: instance,
          strokeColor: "#0f4c81",
          strokeWeight: 1,
          fillColor: "#0f4c81",
          fillOpacity: 0.08,
        });
        overlays.current.push(halo);
      }
      points.push(driver);
    }

    for (const nearby of nearbyDrivers ?? []) {
      const car = new maps.Marker({
        position: { lat: nearby.lat, lng: nearby.lng },
        map: instance,
        icon: {
          path: "M-9,-3 L-7,-7 L7,-7 L9,-3 L9,4 L6,4 L6,6 L3,6 L3,4 L-3,4 L-3,6 L-6,6 L-6,4 L-9,4 Z",
          fillColor: "#0f4c81",
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 1.5,
          scale: 0.9,
          anchor: new maps.Point(0, 0),
        },
        title:
          nearby.eta_minutes != null
            ? `Available driver — about ${Math.round(nearby.eta_minutes)} min away`
            : "Available driver",
        zIndex: 1,
      });
      overlays.current.push(car);
    }

    if (points.length === 1) {
      instance.setCenter(points[0]!);
      instance.setZoom(15);
    } else if (points.length > 1) {
      const bounds = new maps.LatLngBounds();
      points.forEach((point) => bounds.extend(point));
      instance.fitBounds(bounds, 48);
    }
  }, [pickup, dropoff, driver, nearbyDrivers, polyline, ready]);

  return (
    <div className={`relative ${className ?? "h-full w-full"}`}>
      <div ref={holder} className="h-full w-full" aria-label="Ride map" />
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-muted text-xs text-muted-foreground">
          Map unavailable right now
        </div>
      ) : null}
    </div>
  );
}

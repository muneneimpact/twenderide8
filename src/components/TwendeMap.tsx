import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  lat: number;
  lng: number;
}

interface TwendeMapProps {
  pickup: MapPoint | null;
  dropoff: MapPoint | null;
  driver?: (MapPoint & { accuracy_m?: number | null }) | null;
  /** Which pin the user is currently placing; tapping the map moves it. */
  placing?: "pickup" | "dropoff" | null;
  onPlace?: (point: MapPoint) => void;
  className?: string;
}

const MERU: MapPoint = { lat: 0.0471, lng: 37.6497 };

function pin(colour: string, label: string) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="background:${colour};color:#fff;font:600 10px/1 system-ui;padding:4px 6px;border-radius:6px;white-space:nowrap">${label}</div>
      <div style="width:2px;height:10px;background:${colour}"></div>
      <div style="width:10px;height:10px;border-radius:50%;background:${colour};border:2px solid #fff"></div>
    </div>`,
    iconSize: [40, 34],
    iconAnchor: [20, 34],
  });
}

export default function TwendeMap({
  pickup,
  dropoff,
  driver,
  placing,
  onPlace,
  className,
}: TwendeMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const place = useRef(onPlace);
  const mode = useRef(placing);
  place.current = onPlace;
  mode.current = placing;

  useEffect(() => {
    if (!holder.current || map.current) return;
    const instance = L.map(holder.current, { zoomControl: false, attributionControl: false }).setView(
      [pickup?.lat ?? MERU.lat, pickup?.lng ?? MERU.lng],
      14,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(instance);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (!mode.current) return;
      place.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    });
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    const group = layer.current;
    if (!instance || !group) return;
    group.clearLayers();
    const points: MapPoint[] = [];

    if (pickup) {
      L.marker([pickup.lat, pickup.lng], { icon: pin("#1f6f4a", "Pickup") }).addTo(group);
      points.push(pickup);
    }
    if (dropoff) {
      L.marker([dropoff.lat, dropoff.lng], { icon: pin("#8a5a12", "Destination") }).addTo(group);
      points.push(dropoff);
    }
    if (pickup && dropoff) {
      L.polyline(
        [
          [pickup.lat, pickup.lng],
          [dropoff.lat, dropoff.lng],
        ],
        { color: "#1f6f4a", weight: 3, dashArray: "6 8", opacity: 0.7 },
      ).addTo(group);
    }
    if (driver) {
      L.marker([driver.lat, driver.lng], { icon: pin("#0f4c81", "Driver") }).addTo(group);
      if (driver.accuracy_m) {
        L.circle([driver.lat, driver.lng], {
          radius: Math.min(driver.accuracy_m, 500),
          color: "#0f4c81",
          weight: 1,
          fillOpacity: 0.08,
        }).addTo(group);
      }
      points.push(driver);
    }

    if (points.length === 1) {
      instance.setView([points[0]!.lat, points[0]!.lng], 15);
    } else if (points.length > 1) {
      instance.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [48, 48],
      });
    }
  }, [pickup, dropoff, driver]);

  return (
    <div className={`relative ${className ?? "h-full w-full"}`}>
      <div ref={holder} className="h-full w-full" aria-label="Ride map" />
      <span className="pointer-events-none absolute bottom-1 left-1.5 z-[400] text-[9px] text-foreground/40">
        © OpenStreetMap
      </span>
    </div>
  );
}

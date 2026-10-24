import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { decodePolyline } from "@/lib/polyline";

interface Point {
  lat: number;
  lng: number;
}

interface LeafletMapProps {
  pickup: Point | null;
  dropoff: Point | null;
  driver?: (Point & { accuracy_m?: number | null }) | null | undefined;
  nearbyDrivers?: Array<Point & { eta_minutes?: number | null }> | undefined;
  polyline?: string | null | undefined;
  driverRoutePolyline?: string | null | undefined;
  placing?: "pickup" | "dropoff" | null | undefined;
  onPlace?: ((point: Point) => void) | undefined;
}

const MERU: Point = { lat: 0.0471, lng: 37.6497 };

/** Our own map, used whenever Google's map can't render on this domain. */
export default function LeafletMap(props: LeafletMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const place = useRef(props.onPlace);
  const mode = useRef(props.placing);
  place.current = props.onPlace;
  mode.current = props.placing;

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const L = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelled || !holder.current || map.current) return;
      const start = props.pickup ?? MERU;
      const instance = L.map(holder.current, { zoomControl: false, attributionControl: false }).setView(
        [start.lat, start.lng],
        14,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(instance);
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      instance.on("click", (event) => {
        if (!mode.current) return;
        place.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
      });
      lib.current = L;
      layer.current = L.layerGroup().addTo(instance);
      map.current = instance;
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const L = lib.current;
    const instance = map.current;
    const group = layer.current;
    if (!L || !instance || !group) return;
    group.clearLayers();
    const points: Array<[number, number]> = [];
    const pin = (p: Point, colour: string, label: string) => {
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;flex-direction:column;align-items:center"><div style="background:${colour};color:#fff;font:600 10px/1 system-ui;padding:4px 6px;border-radius:6px;white-space:nowrap">${label}</div><div style="width:10px;height:10px;border-radius:50%;background:${colour};border:2px solid #fff;margin-top:2px"></div></div>`,
          iconSize: [60, 30],
          iconAnchor: [30, 30],
        }),
      }).addTo(group);
      points.push([p.lat, p.lng]);
    };
    const line = (encoded: string | null | undefined, colour: string) => {
      const road = encoded ? decodePolyline(encoded) : [];
      if (road.length < 2) return;
      L.polyline(road.map((p) => [p.lat, p.lng] as [number, number]), { color: colour, weight: 5, opacity: 0.9 }).addTo(group);
      road.forEach((p) => points.push([p.lat, p.lng]));
    };
    const { pickup, dropoff, driver, nearbyDrivers, polyline, driverRoutePolyline } = props;
    if (pickup && dropoff) line(polyline, "#1f6f4a");
    if (driver) line(driverRoutePolyline, "#0f4c81");
    if (pickup) pin(pickup, "#1f6f4a", "Pickup");
    if (dropoff) pin(dropoff, "#8a5a12", "Destination");
    if (driver) {
      pin(driver, "#0f4c81", "Driver");
      if (driver.accuracy_m)
        L.circle([driver.lat, driver.lng], { radius: Math.min(driver.accuracy_m, 500), color: "#0f4c81", weight: 1, fillOpacity: 0.08 }).addTo(group);
    }
    for (const n of nearbyDrivers ?? []) {
      L.circleMarker([n.lat, n.lng], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#0f4c81", fillOpacity: 0.95 }).addTo(group);
    }
    if (points.length === 1) instance.setView(points[0]!, 15);
    else if (points.length > 1) instance.fitBounds(L.latLngBounds(points), { padding: [48, 48] });
  }

  useEffect(draw, [props.pickup, props.dropoff, props.driver, props.nearbyDrivers, props.polyline, props.driverRoutePolyline]);

  return <div ref={holder} className="h-full w-full" aria-label="Ride map" />;
}

import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

export interface MapPanelPoint {
  lat: number;
  lng: number;
}

const TwendeMap = lazy(() => import("./TwendeMap"));

interface MapPanelProps {
  pickup: MapPanelPoint | null;
  dropoff: MapPanelPoint | null;
  driver?: (MapPanelPoint & { accuracy_m?: number | null }) | null;
  placing?: "pickup" | "dropoff" | null;
  onPlace?: (point: MapPanelPoint) => void;
  className?: string;
}

function MapSkeleton({ className }: { className: string }) {
  return <div className={`${className} animate-pulse bg-muted`} />;
}

/** Leaflet touches window, so the map only ever renders in the browser. */
export function MapPanel({ className, ...props }: MapPanelProps) {
  const shell = className ?? "h-full w-full";
  return (
    <ClientOnly fallback={<MapSkeleton className={shell} />}>
      <Suspense fallback={<MapSkeleton className={shell} />}>
        <TwendeMap {...props} className={shell} />
      </Suspense>
    </ClientOnly>
  );
}

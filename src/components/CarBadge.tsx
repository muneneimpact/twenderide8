import { Bike } from "lucide-react";
import { isMotorbikeClass } from "@/lib/plate";
import { colourSwatch } from "@/lib/plate";

/**
 * Small car glyph tinted with the vehicle's colour, next to the plate. It gives
 * customers something to match against at the kerb without reading text.
 */
export function CarBadge({
  colour,
  plate,
  detail,
  vehicleClass,
  className = "",
}: {
  vehicleClass?: string | null;
  colour?: string | null;
  plate: string;
  detail?: string | null;
  className?: string;
}) {
  const hex = colourSwatch(colour);
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border"
        style={{ backgroundColor: `${hex}22` }}
      >
        {isMotorbikeClass(vehicleClass) ? (
          <Bike className="h-5 w-5" style={{ color: hex }} />
        ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill={hex}>
          <path d="M5 11l1.5-4A2 2 0 0 1 8.4 5.7h7.2A2 2 0 0 1 17.5 7L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V17a1 1 0 0 1-1 1h-1.2a1.8 1.8 0 0 1-3.6 0H8.8a1.8 1.8 0 0 1-3.6 0H4a1 1 0 0 1-1-1v-4.5A1.5 1.5 0 0 1 4.5 11H5zm2.1 0h9.8l-1-2.9a.6.6 0 0 0-.6-.4H8.7a.6.6 0 0 0-.6.4L7.1 11z" />
        </svg>
        )}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold tracking-wide text-foreground">{plate}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  );
}

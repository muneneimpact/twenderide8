import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchPlaces } from "@/lib/rides.functions";

export interface FoundPlace {
  label: string;
  address: string | null;
  lat: number;
  lng: number;
}

/**
 * Type-ahead place finder. Results are re-queried as the person types and are
 * biased towards where they already are, so each extra character moves the
 * suggestions closer to the real place.
 */
export function PlaceSearch({
  placeholder,
  near,
  onPick,
  prominent = false,
  value,
}: {
  placeholder: string;
  near?: { lat: number; lng: number } | null;
  onPick: (place: FoundPlace) => void;
  /** Renders the field large and bold — used for the main "Where to?" input. */
  prominent?: boolean;
  /** Text to show when the caller already knows the chosen place. */
  value?: string | null;
}) {
  const search = useServerFn(searchPlaces);
  const [query, setQuery] = useState(value ?? "");
  const [results, setResults] = useState<FoundPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const requestId = useRef(0);
  const justPicked = useRef(false);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 3) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      try {
        const places = (await search({
          data: { query: value, ...(near ? { near: { lat: near.lat, lng: near.lng } } : {}) },
        })) as FoundPlace[];
        if (id === requestId.current) setResults(places);
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
    // near is intentionally read as a value snapshot each keystroke
  }, [query, near?.lat, near?.lng, search]);

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setTouched(true);
        }}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
      />
      {busy ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          searching…
        </span>
      ) : null}

      {results.length > 0 && (
        <ul className="glass-strong absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl p-1">
          {results.slice(0, 6).map((place) => (
            <li key={`${place.lat},${place.lng},${place.label}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(place);
                  setQuery(place.label);
                  setResults([]);
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
              >
                <span className="font-medium">{place.label}</span>
                {place.address ? (
                  <span className="block truncate text-xs text-muted-foreground">{place.address}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {touched && !busy && query.trim().length >= 3 && results.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          No match yet — keep typing, or drop the pin on the map instead.
        </p>
      ) : null}
    </div>
  );
}

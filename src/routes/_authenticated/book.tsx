import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MapPanel } from "@/components/MapPanel";
import { createQuote, estimateClasses, requestRide, reverseGeocode } from "@/lib/rides.functions";
import { PlaceSearch } from "@/components/PlaceSearch";
import { nearbyDrivers } from "@/lib/nearby.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/book")({
  head: () => ({
    meta: [
      { title: "Book a taxi — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Set your pickup pin and destination, see the itemised fare before you request, then pay by M-PESA or cash.",
      },
      { property: "og:title", content: "Book a taxi — Twende Meru Rides" },
      { property: "og:description", content: "Map-led taxi booking in Meru with a locked, itemised fare." },
    ],
  }),
  component: BookPage,
});

type VehicleClass = "boda" | "economy" | "comfort" | "xl";

const CLASS_LABELS: Record<VehicleClass, { name: string; hint: string }> = {
  boda: { name: "Boda", hint: "One rider, quickest" },
  economy: { name: "Economy", hint: "Everyday saloon car" },
  comfort: { name: "Comfort", hint: "Newer, roomier car" },
  xl: { name: "XL", hint: "Up to 6 seats" },
};

interface Point {
  lat: number;
  lng: number;
  label?: string | null;
  address?: string | null;
}

const RECENTS_KEY = "twende.recent-destinations";

/** Recent destinations are a convenience only, so they live on the device. */
function readRecents(): Point[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Point[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function writeRecents(points: Point[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(points.slice(0, 5)));
  } catch {
    // A full or blocked storage quota must never break booking.
  }
}

function label(point: Point | null) {
  if (!point) return "Not set";
  return point.label ?? point.address ?? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function BookPage() {
  const navigate = useNavigate();
  const reverse = useServerFn(reverseGeocode);
  const estimateFn = useServerFn(estimateClasses);
  const quoteFn = useServerFn(createQuote);
  const requestFn = useServerFn(requestRide);
  const nearbyFn = useServerFn(nearbyDrivers);

  const [placing, setPlacing] = useState<"pickup" | "dropoff">("dropoff");
  const [locating, setLocating] = useState(true);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("economy");
  const [pickupNotes, setPickupNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stk_push" | "cash">("stk_push");
  const [msisdn, setMsisdn] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingDropoff, setPendingDropoff] = useState<Point | null>(null);
  const [recents, setRecents] = useState<Point[]>(() => readRecents());
  const searchInput = useRef<HTMLInputElement | null>(null);

  // Saved places live with the customer, so Home and Office survive devices.
  const saved = useQuery({
    queryKey: ["saved-places"],
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_places")
        .select("id, label, address, lat, lng")
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  const resolvePoint = useCallback(
    async (point: { lat: number; lng: number }) => {
      // Geolocation can resolve during the brief hand-off between the route
      // guard and client auth hydration. Never call a protected server
      // function until the bearer token is available.
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) return null;
      return reverse({ data: point });
    },
    [reverse],
  );

  const quoting = useMutation({
    mutationFn: () =>
      quoteFn({
        data: {
          pickup: { lat: pickup!.lat, lng: pickup!.lng, address: label(pickup) },
          dropoff: { lat: dropoff!.lat, lng: dropoff!.lng, address: label(dropoff) },
          vehicleClass,
          pickupNotes: pickupNotes.trim() ? pickupNotes.trim() : null,
        },
      }),
  });

  const estimating = useMutation({
    mutationFn: () =>
      estimateFn({
        data: {
          pickup: { lat: pickup!.lat, lng: pickup!.lng },
          dropoff: { lat: dropoff!.lat, lng: dropoff!.lng },
        },
      }),
  });

  // One tap: price the route on the server, keep that quote and start the
  // driver search. The customer never has to "lock" a fare by hand.
  const requesting = useMutation({
    mutationFn: async () => {
      const priced = await quoteFn({
        data: {
          pickup: { lat: pickup!.lat, lng: pickup!.lng, address: label(pickup) },
          dropoff: { lat: dropoff!.lat, lng: dropoff!.lng, address: label(dropoff) },
          vehicleClass,
          pickupNotes: pickupNotes.trim() ? pickupNotes.trim() : null,
        },
      });
      return requestFn({
        data: {
          quoteId: priced.quote.id,
          paymentMethod,
          msisdn: paymentMethod === "stk_push" ? msisdn : null,
          idempotencyKey: crypto.randomUUID(),
        },
      });
    },
    onSuccess: (result) => {
      navigate({ to: "/rides/$rideId", params: { rideId: result.ride.id } });
    },
  });

  async function placePin(point: { lat: number; lng: number }) {
    const target = placing;
    const next: Point = { ...point };
    if (target === "pickup") setPickup(next);
    else setDropoff(next);
    quoting.reset();
    try {
      const resolved = await resolvePoint(point);
      if (!resolved) return;
      const enriched: Point = { ...point, label: resolved.label, address: resolved.address };
      if (target === "pickup") setPickup(enriched);
      else setDropoff(enriched);
    } catch {
      // Coordinates remain the source of truth even if the label lookup fails.
    }
  }

  // Pickup defaults to where the phone says you are; you only type where to.
  const useCurrentLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocating(false);
      setLocateError("This device can't share your location — drop the pickup pin on the map.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setPickup({ ...point, label: "Current location" });
        setLocating(false);
        quoting.reset();
        try {
          const resolved = await resolvePoint(point);
          if (!resolved) return;
          setPickup({ ...point, label: resolved.label, address: resolved.address });
        } catch {
          // Coordinates stay authoritative even without a friendly name.
        }
      },
      () => {
        setLocating(false);
        setLocateError("We couldn't read your location — drop the pickup pin on the map instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvePoint]);

  useEffect(() => {
    useCurrentLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Price every vehicle class as soon as both ends of the trip are known.
  useEffect(() => {
    if (!pickup || !dropoff) return;
    estimating.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // Live, anonymised supply around the pickup: the rider sees real cars, and
  // the hex-bounded server query keeps map-provider usage flat.
  const supply = useQuery({
    queryKey: ["nearby-drivers", pickup?.lat.toFixed(3), pickup?.lng.toFixed(3), vehicleClass],
    enabled: Boolean(pickup),
    refetchInterval: 20000,
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) return { drivers: [], radiusKm: 5 };
      return nearbyFn({ data: { lat: pickup!.lat, lng: pickup!.lng, vehicleClass } });
    },
  });
  const nearby = supply.data?.drivers ?? [];

  const estimates = estimating.data?.options ?? [];
  const chosen = estimates.find((item) => item.vehicleClass === vehicleClass);

  function chooseDestination(point: Point) {
    setDropoff(point);
    setSearchOpen(false);
    quoting.reset();
    const next = [point, ...recents.filter((item) => label(item) !== label(point))].slice(0, 5);
    setRecents(next);
    writeRecents(next);
  }

  return (
    <AppShell title="Book a taxi" hideNav={searchOpen}>
      <div className="h-64 w-full border-b border-border">
        <MapPanel
          pickup={pickup}
          dropoff={dropoff}
          nearbyDrivers={nearby}
          placing={placing}
          onPlace={placePin}
          className="h-64 w-full"
        />
      </div>

      <div className="mx-auto max-w-md px-4 py-4">
        {/* Pickup is your current location by default — you only say where to. */}
        <div className="surface-card flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pickup</p>
            <p className="truncate text-sm font-medium text-foreground">
              {locating ? "Finding your location…" : label(pickup)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={useCurrentLocation}
              className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground"
            >
              Use my location
            </button>
            <button
              onClick={() => setPlacing(placing === "pickup" ? "dropoff" : "pickup")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                placing === "pickup"
                  ? "bg-primary text-primary-foreground"
                  : "border border-input text-muted-foreground"
              }`}
            >
              {placing === "pickup" ? "Tap map…" : "Change"}
            </button>
          </div>
        </div>
        {locateError && <p className="mt-2 text-xs text-destructive">{locateError}</p>}

        {/* Where to is the whole job: one big tap opens a full-screen search. */}
        <button
          onClick={() => {
            setPlacing("dropoff");
            setPendingDropoff(dropoff);
            setSearchOpen(true);
            window.setTimeout(() => searchInput.current?.focus(), 60);
          }}
          className="mt-4 w-full rounded-2xl border-2 border-border bg-card px-4 py-4 text-left"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Destination
          </span>
          <span className="mt-0.5 block truncate font-display text-2xl font-bold leading-tight text-foreground">
            {dropoff ? label(dropoff) : "Where to?"}
          </span>
        </button>

        {/* Recent and saved destinations, straight from the customer's own data. */}
        {!dropoff && (recents.length > 0 || (saved.data?.length ?? 0) > 0) ? (
          <div className="mt-3 space-y-1.5">
            {(saved.data ?? []).map((place) => (
              <button
                key={place.id}
                onClick={() =>
                  chooseDestination({
                    lat: Number(place.lat),
                    lng: Number(place.lng),
                    label: place.label,
                    address: place.address,
                  })
                }
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
              >
                <span className="text-base">★</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{place.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{place.address ?? "Saved place"}</span>
                </span>
              </button>
            ))}
            {recents.map((place, index) => (
              <button
                key={`${label(place)}-${index}`}
                onClick={() => chooseDestination(place)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
              >
                <span className="text-base">↻</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{label(place)}</span>
                  <span className="block truncate text-xs text-muted-foreground">Recent</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {dropoff ? (
          <dl className="mt-4 space-y-1 rounded-2xl border border-border bg-card p-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Pickup</dt>
              <dd className="text-right text-foreground">{label(pickup)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Destination</dt>
              <dd className="text-right text-foreground">{label(dropoff)}</dd>
            </div>
            {estimating.data ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Distance</dt>
                  <dd className="text-right text-foreground">{estimating.data.distance_km.toFixed(1)} km</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Estimated fare</dt>
                  <dd className="text-right font-semibold text-foreground">
                    {chosen && chosen.available ? `KES ${chosen.total.toFixed(2)}` : "—"}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : null}


        {/* The ride picker only appears once we know where the customer is going. */}
        {pickup && dropoff ? (
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-lg font-bold text-foreground">Choose your ride</span>
              {estimating.isPending ? (
                <span className="text-xs text-muted-foreground">Checking prices…</span>
              ) : estimating.data ? (
                <span className="text-xs text-muted-foreground">
                  {estimating.data.distance_km.toFixed(1)} km · {Math.round(estimating.data.duration_minutes)} min
                </span>
              ) : null}
            </div>
            <div className="mt-2 space-y-2">
              {(["boda", "economy", "comfort", "xl"] as const).map((option) => {
                const priced = estimates.find((item) => item.vehicleClass === option);
                const selected = vehicleClass === option;
                const unavailable = priced ? !priced.available : false;
                return (
                  <button
                    key={option}
                    disabled={unavailable}
                    onClick={() => {
                      setVehicleClass(option);
                      quoting.reset();
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${
                      selected ? "border-primary bg-accent" : "border-border bg-card"
                    } disabled:opacity-60`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">
                        {CLASS_LABELS[option].name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {unavailable ? "Not available on this route" : CLASS_LABELS[option].hint}
                      </span>
                      {priced && priced.available && priced.discount_percent > 0 ? (
                        <span className="mt-1 inline-flex rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-gold-foreground">
                          {priced.discount_label ?? `${priced.discount_percent}% off`}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      {priced && priced.available ? (
                        <>
                          {priced.discount_percent > 0 ? (
                            <span className="block text-xs text-muted-foreground line-through">
                              KES {priced.total_before_discount.toFixed(0)}
                            </span>
                          ) : null}
                          <span className="font-display text-base font-bold text-foreground">
                            KES {priced.total.toFixed(0)}
                          </span>
                        </>
                      ) : estimating.isPending ? (
                        <span className="text-xs text-muted-foreground">…</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {estimating.isError ? (
              <p className="mt-2 text-xs text-destructive">{(estimating.error as Error).message}</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-border bg-secondary px-3 py-3 text-sm text-secondary-foreground">
            Tell us where you're going and we'll show every ride option with its price.
          </p>
        )}


        {pickup && dropoff ? (
          <>
            <label className="mt-4 block">
              <span className="text-xs font-medium text-muted-foreground">Pickup notes (optional)</span>
              <input
                value={pickupNotes}
                onChange={(event) => setPickupNotes(event.target.value)}
                placeholder="Gate colour, landmark, floor…"
                className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">Payment</span>
              <div className="mt-1 flex gap-2">
                {(
                  [
                    { key: "stk_push", label: "M-PESA" },
                    { key: "cash", label: "Cash" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setPaymentMethod(option.key)}
                    className={`flex-1 rounded-full px-3 py-2.5 text-sm font-semibold transition-colors ${
                      paymentMethod === option.key
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "stk_push" && (
              <label className="mt-3 block">
                <span className="text-xs font-medium text-muted-foreground">M-PESA number</span>
                <input
                  value={msisdn}
                  onChange={(event) => setMsisdn(event.target.value)}
                  inputMode="tel"
                  placeholder="07XX XXX XXX"
                  className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            )}

            <p className="mt-2 rounded-2xl bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary-foreground">
              {paymentMethod === "stk_push"
                ? "Paying by M-PESA settles the whole trip — nothing more to pay the driver."
                : "Cash means you settle with the driver at the end of the trip."}
            </p>

            {/* No separate fare lock: this prices the route and finds a driver. */}
            <button
              disabled={
                requesting.isPending || (paymentMethod === "stk_push" && msisdn.trim().length < 9)
              }
              onClick={() => requesting.mutate()}
              className="mt-4 w-full rounded-full bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-sm disabled:opacity-60"
            >
              {requesting.isPending
                ? "Finding your driver…"
                : `Find a driver · ${CLASS_LABELS[vehicleClass].name}${
                    chosen && chosen.available ? ` · KES ${chosen.total.toFixed(0)}` : ""
                  }`}
            </button>
            {requesting.isError && (
              <p className="mt-2 text-sm text-destructive">{(requesting.error as Error).message}</p>
            )}
          </>
        ) : null}
      </div>

      {searchOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <button
              onClick={() => setSearchOpen(false)}
              className="rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              Close
            </button>
            <p className="font-display text-lg font-bold text-foreground">Where to?</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <PlaceSearch
              prominent
              inputRef={searchInput}
              placeholder="Type your destination"
              near={pickup ?? dropoff}
              value={pendingDropoff?.label ?? null}
              onPick={(place) => {
                setPendingDropoff({
                  lat: place.lat,
                  lng: place.lng,
                  label: place.label,
                  address: place.address,
                });
                // Free the screen for the confirm button; tapping the field
                // brings the keyboard straight back.
                searchInput.current?.blur();
              }}
            />
            {(saved.data ?? []).map((place) => (
              <button
                key={place.id}
                onClick={() =>
                  setPendingDropoff({
                    lat: Number(place.lat),
                    lng: Number(place.lng),
                    label: place.label,
                    address: place.address,
                  })
                }
                className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
              >
                <span>★</span>
                <span className="truncate text-sm font-semibold text-foreground">{place.label}</span>
              </button>
            ))}
            {recents.map((place, index) => (
              <button
                key={`recent-${index}`}
                onClick={() => setPendingDropoff(place)}
                className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
              >
                <span>↻</span>
                <span className="truncate text-sm font-semibold text-foreground">{label(place)}</span>
              </button>
            ))}
          </div>
          {pendingDropoff ? (
            <div className="border-t border-border bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <button
                onClick={() => chooseDestination(pendingDropoff)}
                className="w-full truncate rounded-full bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground"
              >
                Continue with {label(pendingDropoff)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </AppShell>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MapPanel } from "@/components/MapPanel";
import { createQuote, estimateClasses, requestRide, reverseGeocode } from "@/lib/rides.functions";
import { PlaceSearch } from "@/components/PlaceSearch";

export const Route = createFileRoute("/_authenticated/book")({
  head: () => ({
    meta: [
      { title: "Book a taxi — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Set your pickup pin and destination, see the itemised fare before you request, then pay by M-PESA or cash.",
      },
      { property: "og:title", content: "Book a taxi — Twende Ride" },
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

  const [placing, setPlacing] = useState<"pickup" | "dropoff">("dropoff");
  const [locating, setLocating] = useState(true);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("economy");
  const [pickupNotes, setPickupNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stk_push" | "cash">("stk_push");
  const [msisdn, setMsisdn] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

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

  const requesting = useMutation({
    mutationFn: () =>
      requestFn({
        data: {
          quoteId: quoting.data!.quote.id,
          paymentMethod,
          msisdn: paymentMethod === "stk_push" ? msisdn : null,
          idempotencyKey: crypto.randomUUID(),
        },
      }),
    onSuccess: (result) => {
      navigate({ to: "/rides/$rideId", params: { rideId: result.ride.id } });
    },
  });

  const quote = quoting.data;

  // The quote is only valid for the window the server stamped on it.
  useEffect(() => {
    if (!quote) return;
    const expiry = new Date(quote.quote.expires_at).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiry - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  async function placePin(point: { lat: number; lng: number }) {
    const target = placing;
    const next: Point = { ...point };
    if (target === "pickup") setPickup(next);
    else setDropoff(next);
    quoting.reset();
    try {
      const resolved = await reverse({ data: point });
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
          const resolved = await reverse({ data: point });
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
  }, [reverse]);

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

  const estimates = estimating.data?.options ?? [];
  const expired = Boolean(quote) && secondsLeft <= 0;

  return (
    <AppShell title="Book a taxi">
      <div className="h-64 w-full border-b border-border">
        <MapPanel
          pickup={pickup}
          dropoff={dropoff}
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

        <div className="mt-3">
          <PlaceSearch
            placeholder={placing === "pickup" ? "Search pickup (e.g. Makutano)" : "Where to?"}
            near={placing === "pickup" ? pickup ?? dropoff : pickup ?? dropoff}
            onPick={(place) => {
              const picked: Point = {
                lat: place.lat,
                lng: place.lng,
                label: place.label,
                address: place.address,
              };
              if (placing === "pickup") {
                setPickup(picked);
                setPlacing("dropoff");
              } else {
                setDropoff(picked);
              }
              quoting.reset();
            }}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Type where you're going, or tap the map to drop the{" "}
            {placing === "pickup" ? "pickup" : "destination"} pin.
          </p>
        </div>

        <dl className="mt-4 space-y-1 rounded-lg border border-border bg-card p-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Pickup</dt>
            <dd className="text-right text-foreground">{label(pickup)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Destination</dt>
            <dd className="text-right text-foreground">{label(dropoff)}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground">Choose your ride</span>
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
                  className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card"
                  } disabled:opacity-45`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {CLASS_LABELS[option].name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {unavailable ? "Not available on this route" : CLASS_LABELS[option].hint}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {priced && priced.available ? (
                      <span className="font-display text-base font-semibold text-foreground">
                        KES {priced.total.toFixed(0)}
                      </span>
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

        <label className="mt-4 block">
          <span className="text-xs font-medium text-muted-foreground">Pickup notes (optional)</span>
          <input
            value={pickupNotes}
            onChange={(event) => setPickupNotes(event.target.value)}
            placeholder="Gate colour, landmark, floor…"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <button
          disabled={!pickup || !dropoff || quoting.isPending}
          onClick={() => quoting.mutate()}
          className="mt-4 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {quoting.isPending ? "Locking your fare…" : quote ? "Recalculate fare" : "Show my fare"}
        </button>
        {quoting.isError && (
          <p className="mt-2 text-sm text-destructive">{(quoting.error as Error).message}</p>
        )}

        {quote && (
          <section className="mt-5 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Your locked fare</h2>
            <p className="mt-1 font-display text-3xl font-semibold text-foreground">
              KES {Number(quote.quote.total_fare).toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {Number(quote.quote.distance_km).toFixed(1)} km · about{" "}
              {Math.round(Number(quote.quote.duration_minutes))} min ·{" "}
              {expired ? "expired — recalculate" : `valid for ${secondsLeft}s`}
            </p>

            <ul className="mt-3 space-y-1 text-sm">
              {[
                { label: "Booking fee", amount: quote.breakdown.booking_fee + quote.breakdown.base_fare },
                { label: "Distance", amount: quote.breakdown.distance_charge },
                { label: "Long-distance saving", amount: -quote.breakdown.long_distance_saving },
                { label: "Time", amount: quote.breakdown.time_charge },
                ...quote.breakdown.modifiers.map((modifier) => ({
                  label: modifier.label,
                  amount: modifier.amount,
                })),
              ]
                .filter((line) => Math.abs(line.amount) >= 0.005)
                .map((line) => (
                  <li key={line.label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{line.label}</span>
                    <span className="text-foreground">KES {line.amount.toFixed(2)}</span>
                  </li>
                ))}
            </ul>

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
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      paymentMethod === option.key
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-2 rounded-2xl bg-secondary px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {paymentMethod === "stk_push"
                ? "Paying by M-PESA here settles the whole trip. Get in, get out — nothing more to pay the driver."
                : "Cash means you still settle with the driver at the end of the trip. Pay by M-PESA now to avoid extra charges later."}
            </p>

            {paymentMethod === "stk_push" && (
              <label className="mt-3 block">
                <span className="text-xs font-medium text-muted-foreground">M-PESA number</span>
                <input
                  value={msisdn}
                  onChange={(event) => setMsisdn(event.target.value)}
                  inputMode="tel"
                  placeholder="07XX XXX XXX"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            )}

            <button
              disabled={
                requesting.isPending || expired || (paymentMethod === "stk_push" && msisdn.trim().length < 9)
              }
              onClick={() => requesting.mutate()}
              className="mt-4 w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-brand-foreground disabled:opacity-50"
            >
              {requesting.isPending ? "Finding a driver…" : "Request this taxi"}
            </button>
            {requesting.isError && (
              <p className="mt-2 text-sm text-destructive">{(requesting.error as Error).message}</p>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MapPanel } from "@/components/MapPanel";
import { createQuote, requestRide, reverseGeocode, searchPlaces } from "@/lib/rides.functions";

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

type VehicleClass = "economy" | "comfort" | "xl";

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
  const search = useServerFn(searchPlaces);
  const reverse = useServerFn(reverseGeocode);
  const quoteFn = useServerFn(createQuote);
  const requestFn = useServerFn(requestRide);

  const [placing, setPlacing] = useState<"pickup" | "dropoff">("pickup");
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Point[]>([]);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("economy");
  const [pickupNotes, setPickupNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stk_push" | "cash">("stk_push");
  const [msisdn, setMsisdn] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  const searching = useMutation({
    mutationFn: (value: string) => search({ data: { query: value, near: pickup ?? undefined } }),
    onSuccess: (places) => setResults(places as Point[]),
  });

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
        <p className="text-xs text-muted-foreground">
          Tap the map to drop the {placing === "pickup" ? "pickup" : "destination"} pin, or search for a place.
          The pin is what the driver navigates to.
        </p>

        <div className="mt-3 flex gap-2">
          {(["pickup", "dropoff"] as const).map((key) => (
            <button
              key={key}
              onClick={() => {
                setPlacing(key);
                setResults([]);
                setQuery("");
              }}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                placing === key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
              }`}
            >
              {key === "pickup" ? "Pickup" : "Destination"}
            </button>
          ))}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim().length >= 2) searching.mutate(query.trim());
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placing === "pickup" ? "Search pickup" : "Search destination"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={searching.isPending}
            className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground disabled:opacity-60"
          >
            {searching.isPending ? "…" : "Find"}
          </button>
        </form>

        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border">
            {results.slice(0, 5).map((place) => (
              <li key={`${place.lat},${place.lng}`}>
                <button
                  onClick={() => {
                    if (placing === "pickup") setPickup(place);
                    else setDropoff(place);
                    setResults([]);
                    setQuery("");
                    quoting.reset();
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                >
                  <span className="font-medium">{place.label ?? "Selected point"}</span>
                  {place.address ? (
                    <span className="block text-xs text-muted-foreground">{place.address}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}

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
          <span className="text-xs font-medium text-muted-foreground">Vehicle</span>
          <div className="mt-1 flex gap-2">
            {(["economy", "comfort", "xl"] as const).map((option) => (
              <button
                key={option}
                onClick={() => {
                  setVehicleClass(option);
                  quoting.reset();
                }}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  vehicleClass === option
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
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
                { label: "Base fare", amount: quote.breakdown.base_fare },
                { label: "Booking fee", amount: quote.breakdown.booking_fee },
                { label: "Distance", amount: quote.breakdown.distance_charge },
                { label: "Long-distance saving", amount: -quote.breakdown.long_distance_saving },
                { label: "Time", amount: quote.breakdown.time_charge },
                ...quote.breakdown.modifiers.map((modifier) => ({
                  label: modifier.label,
                  amount: modifier.amount,
                })),
                {
                  label: "Rounding",
                  amount: quote.breakdown.total_fare - quote.breakdown.unrounded_total,
                },
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

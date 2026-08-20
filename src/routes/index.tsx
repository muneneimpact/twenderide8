import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { estimateFare, publicSearchPlaces } from "@/lib/rides.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Twende Ride — Taxis in Meru with fares you can see first" },
      {
        name: "description",
        content:
          "Twende Ride books taxis across Meru with a server-calculated fare shown before you request, M-PESA or cash payment, and live driver tracking.",
      },
      { property: "og:title", content: "Twende Ride — Taxis in Meru" },
      {
        property: "og:description",
        content: "See the full itemised fare before you request a taxi in Meru. Pay by M-PESA or cash.",
      },
    ],
  }),
  component: Home,
});

interface Place {
  label: string;
  address: string | null;
  lat: number;
  lng: number;
}

function Home() {
  const search = useServerFn(publicSearchPlaces);
  const estimate = useServerFn(estimateFare);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [field, setField] = useState<"pickup" | "dropoff">("pickup");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);

  const searching = useMutation({
    mutationFn: (value: string) => search({ data: { query: value } }),
    onSuccess: (places) => setResults(places as Place[]),
  });

  const quoting = useMutation({
    mutationFn: () =>
      estimate({
        data: {
          pickup: { lat: pickup!.lat, lng: pickup!.lng, address: pickup!.label },
          dropoff: { lat: dropoff!.lat, lng: dropoff!.lng, address: dropoff!.label },
          vehicleClass: "economy",
        },
      }),
  });

  const fare = quoting.data;

  return (
    <main className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Meru, Kenya</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          Twende Ride
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Check a real fare before you travel. Prices come from the live pricing rules, including the
          long-distance reduction bands, and are rounded exactly as they will be charged.
        </p>

        <section className="mt-8 rounded-xl border border-border bg-card p-4">
          <div className="flex gap-2">
            {(["pickup", "dropoff"] as const).map((key) => (
              <button
                key={key}
                onClick={() => {
                  setField(key);
                  setResults([]);
                  setQuery("");
                }}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  field === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
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
              placeholder={field === "pickup" ? "Where should the taxi collect you?" : "Where are you going?"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={searching.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
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
                      if (field === "pickup") setPickup(place);
                      else setDropoff(place);
                      setResults([]);
                      setQuery("");
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                  >
                    <span className="font-medium">{place.label}</span>
                    {place.address ? (
                      <span className="block text-xs text-muted-foreground">{place.address}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Pickup</dt>
              <dd className="text-right text-foreground">{pickup?.label ?? "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Destination</dt>
              <dd className="text-right text-foreground">{dropoff?.label ?? "Not set"}</dd>
            </div>
          </dl>

          <button
            disabled={!pickup || !dropoff || quoting.isPending}
            onClick={() => quoting.mutate()}
            className="mt-4 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {quoting.isPending ? "Calculating fare…" : "Show my fare"}
          </button>
          {quoting.isError && (
            <p className="mt-3 text-sm text-destructive">{(quoting.error as Error).message}</p>
          )}
        </section>

        {fare && (
          <section className="mt-6 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Your fare</h2>
            <p className="mt-1 text-3xl font-semibold text-foreground">
              KES {fare.breakdown.total_fare.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {fare.distance_km.toFixed(1)} km · about {Math.round(fare.duration_minutes)} min · route from{" "}
              {fare.provider}
            </p>
            <ul className="mt-4 space-y-1 text-sm">
              {[
                { label: "Base fare", amount: fare.breakdown.base_fare },
                { label: "Booking fee", amount: fare.breakdown.booking_fee },
                { label: "Distance", amount: fare.breakdown.distance_charge },
                { label: "Long-distance saving", amount: -fare.breakdown.long_distance_saving },
                { label: "Time", amount: fare.breakdown.time_charge },
                ...fare.breakdown.modifiers.map((modifier) => ({
                  label: modifier.customer_label,
                  amount: modifier.amount,
                })),
                { label: "Rounding", amount: fare.breakdown.total_fare - fare.breakdown.unrounded_total },
              ]
                .filter((line) => Math.abs(line.amount) >= 0.005)
                .map((line) => (
                  <li key={line.label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{line.label}</span>
                    <span className="text-foreground">KES {line.amount.toFixed(2)}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

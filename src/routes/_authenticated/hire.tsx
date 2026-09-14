import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PlaceSearch } from "@/components/PlaceSearch";
import {
  listHireVehicles,
  listMyHireQuotes,
  respondToHireOffer,
  submitHireQuote,
} from "@/lib/hire.functions";

export const Route = createFileRoute("/_authenticated/hire")({
  head: () => ({
    meta: [
      { title: "Hire a car in Meru | Twende Meru Rides" },
      {
        name: "description",
        content:
          "Hire a car in Meru: see the real vehicles available with photos, plates and daily prices, or ask for a fully fuelled, chauffeured quotation.",
      },
      { property: "og:title", content: "Hire a car in Meru | Twende Meru Rides" },
      {
        property: "og:description",
        content: "Self-drive hire with real listed cars, or a full-service quotation with fuel and a driver.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HirePage,
});

const CLASSES = [
  { value: "go", label: "Saloon (Go)" },
  { value: "plus", label: "Plus" },
  { value: "comfort", label: "Comfort" },
  { value: "xl", label: "Van / XL" },
] as const;

const STATUS_COPY: Record<string, string> = {
  submitted: "Waiting for offers",
  quoted: "Offer waiting for you",
  confirmed: "Confirmed",
  declined: "Not available",
};

interface Place {
  label: string;
  lat: number | null;
  lng: number | null;
}

function HirePage() {
  const queryClient = useQueryClient();
  const submitFn = useServerFn(submitHireQuote);
  const listFn = useServerFn(listMyHireQuotes);
  const vehiclesFn = useServerFn(listHireVehicles);
  const respondFn = useServerFn(respondToHireOffer);

  const quotes = useQuery({ queryKey: ["hire-quotes"], queryFn: () => listFn() });
  const vehicles = useQuery({ queryKey: ["hire-vehicles"], queryFn: () => vehiclesFn() });

  // Two very different jobs: drive it yourself, or have everything done for you.
  const [tab, setTab] = useState<"self_drive" | "chauffeured">("self_drive");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [organisation, setOrganisation] = useState("");
  const [vehicleClass, setVehicleClass] = useState<(typeof CLASSES)[number]["value"]>("go");
  const [startAt, setStartAt] = useState("");
  const [days, setDays] = useState(1);
  const [passengers, setPassengers] = useState(1);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const chosenVehicle = (vehicles.data ?? []).find((vehicle) => vehicle.id === vehicleId) ?? null;
  const listed = (vehicles.data ?? []).filter(
    (vehicle) => vehicle.hire_mode === "both" || vehicle.hire_mode === tab || !vehicle.hire_mode,
  );

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          kind: tab === "self_drive" ? "car_hire" : "corporate",
          vehicleId: tab === "self_drive" ? vehicleId : null,
          organisation: organisation.trim() || undefined,
          vehicleClass: (chosenVehicle?.vehicle_class ?? vehicleClass) as typeof vehicleClass,
          driveMode: tab,
          startAt: new Date(startAt).toISOString(),
          days,
          passengers,
          pickupLabel: pickup!.label,
          pickupLat: pickup!.lat,
          pickupLng: pickup!.lng,
          stops: stops.map((stop) => ({ label: stop.label, lat: stop.lat, lng: stop.lng })),
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: (row) => {
      setMessage(
        tab === "self_drive"
          ? `Request ${row.reference} sent to the car owner. Estimate KES ${Number(row.estimated_total).toLocaleString("en-KE")} — they will confirm the price.`
          : `Request ${row.reference} received. Estimate KES ${Number(row.estimated_total).toLocaleString("en-KE")} — fuel and a driver included once confirmed.`,
      );
      setStops([]);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const respond = useMutation({
    mutationFn: (vars: { offerId: string; action: "accept" | "decline" }) => respondFn({ data: vars }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hire-quotes"] }),
  });

  const canSubmit =
    startAt !== "" &&
    Boolean(pickup) &&
    (tab === "chauffeured" || Boolean(vehicleId)) &&
    !submit.isPending;

  return (
    <AppShell title="Hire a car">
      <div className="space-y-4 pb-24">
        <div className="flex gap-2">
          {(
            [
              { key: "self_drive", label: "Drive it myself" },
              { key: "chauffeured", label: "Fuelled and chauffeured" },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              onClick={() => {
                setTab(option.key);
                setVehicleId(null);
              }}
              className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                tab === option.key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-secondary text-secondary-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <section className="surface-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">
            {tab === "self_drive" ? "Pick the car you want" : "Tell us about the trip"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === "self_drive"
              ? "These are the cars listed right now. You collect the car, drive it yourself and fuel it."
              : "We bring the car fuelled with a driver. You get a quotation for the whole trip."}
          </p>

          {tab === "self_drive" ? (
            <div className="mt-3 space-y-2">
              {vehicles.isPending ? <p className="text-xs text-muted-foreground">Loading cars…</p> : null}
              {!vehicles.isPending && listed.length === 0 ? (
                <p className="text-xs text-muted-foreground">No cars are listed for hire at the moment.</p>
              ) : null}
              {listed.map((vehicle) => (
                <button
                  key={vehicle.id}
                  onClick={() => setVehicleId(vehicle.id)}
                  className={`flex w-full gap-3 rounded-2xl border-2 p-2 text-left ${
                    vehicleId === vehicle.id ? "border-primary bg-accent" : "border-border bg-card"
                  }`}
                >
                  {vehicle.photo_link ? (
                    <img
                      src={vehicle.photo_link}
                      alt={`${vehicle.make ?? "Car"} ${vehicle.model ?? ""} on hire in Meru`}
                      loading="lazy"
                      className="h-20 w-28 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="grid h-20 w-28 shrink-0 place-items-center rounded-xl bg-secondary text-[10px] text-muted-foreground">
                      No photo
                    </div>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {vehicle.plate_number} · {vehicle.vehicle_class}
                      {vehicle.seats ? ` · ${vehicle.seats} seats` : ""}
                      {vehicle.colour ? ` · ${vehicle.colour}` : ""}
                    </span>
                    {vehicle.hire_description ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {vehicle.hire_description}
                      </span>
                    ) : null}
                    <span className="mt-1 block font-display text-sm font-bold text-foreground">
                      KES {Number(vehicle.day_rate).toLocaleString("en-KE")} / day
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            <Field label="Company or organisation (optional)">
              <input
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Tukuze Afrika Ltd"
                className="input-base"
              />
            </Field>

            {tab === "chauffeured" ? (
              <Field label="Vehicle">
                <select
                  value={vehicleClass}
                  onChange={(e) => setVehicleClass(e.target.value as typeof vehicleClass)}
                  className="input-base"
                >
                  {CLASSES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date and time">
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="input-base"
                />
              </Field>
              <Field label="Number of days">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                  className="input-base"
                />
              </Field>
            </div>

            <Field label="Passengers">
              <input
                type="number"
                min={1}
                max={60}
                value={passengers}
                onChange={(e) => setPassengers(Math.max(1, Number(e.target.value) || 1))}
                className="input-base"
              />
            </Field>

            {/* Where the car is brought to you — not where you are going. */}
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Where should the car be brought?
              </p>
              {pickup ? (
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{pickup.label}</span>
                  <button
                    onClick={() => setPickup(null)}
                    className="rounded-full border border-input px-2 py-1 text-xs text-muted-foreground"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="mt-1">
                  <PlaceSearch
                    placeholder="Search for the collection point"
                    value={null}
                    onPick={(place) =>
                      setPickup({ label: place.label, lat: place.lat, lng: place.lng })
                    }
                  />
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Places you plan to visit</p>
              {stops.length ? (
                <ol className="mt-2 space-y-2">
                  {stops.map((stop, index) => (
                    <li
                      key={`${stop.label}-${index}`}
                      className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{stop.label}</span>
                      <button
                        onClick={() => setStops(stops.filter((_, i) => i !== index))}
                        aria-label="Remove place"
                        className="rounded-full border border-input px-2 py-1 text-xs text-destructive"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="mt-2">
                <PlaceSearch
                  placeholder="Add a place you will visit"
                  value={null}
                  onPick={(place) =>
                    setStops((current) => [
                      ...current,
                      { label: place.label, lat: place.lat, lng: place.lng },
                    ])
                  }
                />
              </div>
            </div>

            <Field label="Anything else we should know?">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="input-base"
              />
            </Field>

            <button
              onClick={() => submit.mutate()}
              disabled={!canSubmit}
              className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {submit.isPending
                ? "Sending…"
                : tab === "self_drive"
                  ? "Request this car"
                  : "Request a quotation"}
            </button>
            {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
          </div>
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Your requests</h3>
          {(quotes.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No requests yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {(quotes.data ?? []).map((quote) => (
                <li key={quote.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{quote.reference}</p>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                      {STATUS_COPY[quote.status] ?? quote.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(quote.start_at).toLocaleString("en-KE")} · {quote.days} day(s) ·{" "}
                    {quote.vehicle_class} · {quote.drive_mode === "self_drive" ? "Self drive" : "With driver"}
                  </p>
                  <p className="mt-1 font-display text-sm font-semibold text-foreground">
                    {quote.quoted_total == null
                      ? `Estimate KES ${Number(quote.estimated_total).toLocaleString("en-KE")}`
                      : `KES ${Number(quote.quoted_total).toLocaleString("en-KE")}`}
                  </p>
                  {quote.admin_notes ? (
                    <p className="mt-1 text-xs text-muted-foreground">{quote.admin_notes}</p>
                  ) : null}

                  {/* Offers from car owners: take one, or turn it down so
                      another owner with the same kind of car can offer. */}
                  {(quote.offers ?? [])
                    .filter((offer) => offer.status === "offered")
                    .map((offer) => (
                      <div key={offer.id} className="mt-2 rounded-xl border border-border p-2.5">
                        <p className="text-sm font-semibold text-foreground">
                          Offer: KES {Number(offer.price).toLocaleString("en-KE")}
                        </p>
                        {offer.note ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{offer.note}</p>
                        ) : null}
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => respond.mutate({ offerId: offer.id, action: "accept" })}
                            disabled={respond.isPending}
                            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => respond.mutate({ offerId: offer.id, action: "decline" })}
                            disabled={respond.isPending}
                            className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-60"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

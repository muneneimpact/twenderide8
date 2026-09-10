import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { listMyHireQuotes, submitHireQuote } from "@/lib/hire.functions";

export const Route = createFileRoute("/_authenticated/hire")({
  head: () => ({
    meta: [
      { title: "Corporate booking and car hire | Twende Meru Rides" },
      {
        name: "description",
        content:
          "Book a vehicle for a future date in Meru: choose the days, vehicle type and places to visit, and get a quotation.",
      },
      { property: "og:title", content: "Corporate booking and car hire | Twende Meru Rides" },
      {
        property: "og:description",
        content: "Plan multi-day trips with a driver or self-drive and receive a quotation from our team.",
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
  submitted: "With our team",
  quoted: "Quotation ready",
  confirmed: "Confirmed",
  declined: "Not available",
};

function HirePage() {
  const queryClient = useQueryClient();
  const submitFn = useServerFn(submitHireQuote);
  const listFn = useServerFn(listMyHireQuotes);

  const quotes = useQuery({ queryKey: ["hire-quotes"], queryFn: () => listFn() });

  const [organisation, setOrganisation] = useState("");
  const [vehicleClass, setVehicleClass] = useState<(typeof CLASSES)[number]["value"]>("go");
  const [driveMode, setDriveMode] = useState<"chauffeured" | "self_drive">("chauffeured");
  const [startAt, setStartAt] = useState("");
  const [days, setDays] = useState(1);
  const [passengers, setPassengers] = useState(1);
  const [stops, setStops] = useState<string[]>([""]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          kind: "corporate",
          organisation: organisation.trim() || undefined,
          vehicleClass,
          driveMode,
          startAt: new Date(startAt).toISOString(),
          days,
          passengers,
          stops: stops
            .map((label) => label.trim())
            .filter(Boolean)
            .map((label) => ({ label })),
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: (row) => {
      setMessage(
        `Request ${row.reference} received. Estimate KES ${Number(row.estimated_total).toLocaleString("en-KE")} — our team will confirm the final price.`,
      );
      setStops([""]);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const canSubmit = startAt !== "" && stops.some((s) => s.trim().length > 1) && !submit.isPending;

  return (
    <AppShell title="Corporate booking">
      <div className="space-y-4 pb-24">
        <section className="surface-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Plan a trip in advance</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tell us the dates, the vehicle and every place you need to visit. You get an instant estimate and
            our team confirms the final quotation.
          </p>

          <div className="mt-4 space-y-3">
            <Field label="Company or organisation (optional)">
              <input
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Tukuze Afrika Ltd"
                className="input-base"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
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
              <Field label="Driver">
                <select
                  value={driveMode}
                  onChange={(e) => setDriveMode(e.target.value as typeof driveMode)}
                  className="input-base"
                >
                  <option value="chauffeured">With our driver</option>
                  <option value="self_drive">Self drive</option>
                </select>
              </Field>
            </div>

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

            <div>
              <p className="text-xs font-medium text-muted-foreground">Places to visit</p>
              <div className="mt-2 space-y-2">
                {stops.map((stop, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={stop}
                      onChange={(e) =>
                        setStops(stops.map((value, i) => (i === index ? e.target.value : value)))
                      }
                      placeholder={index === 0 ? "Pick-up point" : "Next place"}
                      className="input-base flex-1"
                    />
                    {stops.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setStops(stops.filter((_, i) => i !== index))}
                        className="rounded-xl border border-input px-3 text-sm text-muted-foreground"
                        aria-label="Remove place"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStops([...stops, ""])}
                className="mt-2 rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground"
              >
                Add another place
              </button>
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
              {submit.isPending ? "Sending…" : "Request a quotation"}
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

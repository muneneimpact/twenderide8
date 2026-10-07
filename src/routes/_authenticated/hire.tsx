import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PlaceSearch } from "@/components/PlaceSearch";
import { supabase } from "@/integrations/supabase/client";
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
          "Browse every hire car in Meru with photos, details and booked dates, pick your days and book it, or ask for a fuelled, chauffeured quotation.",
      },
      { property: "og:title", content: "Hire a car in Meru | Twende Meru Rides" },
      {
        property: "og:description",
        content: "Self-drive hire with real listed cars and live availability, or a full-service quotation.",
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

const DAY = 86_400_000;

interface Place {
  label: string;
  lat: number | null;
  lng: number | null;
}

type Vehicle = Awaited<ReturnType<typeof listHireVehicles>>[number];

function overlaps(vehicle: Vehicle, start: Date, days: number) {
  const end = start.getTime() + days * DAY;
  return vehicle.bookings.some(
    (b) => new Date(b.start).getTime() < end && new Date(b.end).getTime() > start.getTime(),
  );
}

function fmtDate(value: string | Date) {
  return new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function HirePage() {
  const queryClient = useQueryClient();
  const submitFn = useServerFn(submitHireQuote);
  const listFn = useServerFn(listMyHireQuotes);
  const vehiclesFn = useServerFn(listHireVehicles);
  const respondFn = useServerFn(respondToHireOffer);

  const quotes = useQuery({ queryKey: ["hire-quotes"], queryFn: () => listFn() });
  const vehicles = useQuery({ queryKey: ["hire-vehicles"], queryFn: () => vehiclesFn() });

  const [tab, setTab] = useState<"self_drive" | "chauffeured">("self_drive");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [modalStartDate, setModalStartDate] = useState<Date | null>(null);

  // Filters
  const [fSeats, setFSeats] = useState("");
  const [fMake, setFMake] = useState("");
  const [fModel, setFModel] = useState("");
  const [fClass, setFClass] = useState("");
  const [fMaxPrice, setFMaxPrice] = useState("");

  // Hirer details and needs
  const [hirerType, setHirerType] = useState<"individual" | "company">("individual");
  const [renterName, setRenterName] = useState("");
  const [renterIdNumber, setRenterIdNumber] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [vehicleClass, setVehicleClass] = useState<(typeof CLASSES)[number]["value"]>("go");
  const [startAt, setStartAt] = useState("");
  const [daysText, setDaysText] = useState("1");
  const [peopleText, setPeopleText] = useState("1");
  const [pickup, setPickup] = useState<Place | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [notes, setNotes] = useState("");
  const [idPath, setIdPath] = useState<string | null>(null);
  const [licensePath, setLicensePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const days = Math.min(90, Math.max(1, Number(daysText) || 1));
  const passengers = Math.min(60, Math.max(1, Number(peopleText) || 1));
  const start = startAt ? new Date(startAt) : null;
  const endDate = start ? new Date(start.getTime() + days * DAY) : null;

  const all = vehicles.data ?? [];
  const makes = useMemo(() => [...new Set(all.map((v) => v.make).filter(Boolean))] as string[], [all]);
  const listed = all.filter((v) => {
    if (!(v.hire_mode === "both" || v.hire_mode === tab || !v.hire_mode)) return false;
    if (fSeats && (v.seats ?? 0) < Number(fSeats)) return false;
    if (fMake && v.make !== fMake) return false;
    if (fModel && !(v.model ?? "").toLowerCase().includes(fModel.toLowerCase())) return false;
    if (fClass && v.vehicle_class !== fClass) return false;
    if (fMaxPrice && Number(v.day_rate) > Number(fMaxPrice)) return false;
    return true;
  });

  const chosen = all.find((v) => v.id === vehicleId) ?? null;
  const opened = all.find((v) => v.id === openId) ?? null;
  const clash = Boolean(chosen && start && overlaps(chosen, start, days));

  async function upload(kind: "id" | "license", file: File) {
    setUploading(kind);
    setMessage(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setUploading(null);
      return;
    }
    const path = `${auth.user.id}/${kind}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
    const { error } = await supabase.storage
      .from("hire-documents")
      .upload(path, file, { upsert: true, contentType: file.type });
    setUploading(null);
    if (error) return setMessage(error.message);
    if (kind === "id") setIdPath(path);
    else setLicensePath(path);
  }

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          kind: hirerType === "company" ? "corporate" : "car_hire",
          vehicleId: tab === "self_drive" ? vehicleId : null,
          organisation: hirerType === "company" ? organisation.trim() || undefined : undefined,
          vehicleClass: (chosen?.vehicle_class ?? vehicleClass) as typeof vehicleClass,
          driveMode: tab,
          startAt: new Date(startAt).toISOString(),
          days,
          passengers,
          pickupLabel: pickup!.label,
          pickupLat: pickup!.lat,
          pickupLng: pickup!.lng,
          stops: stops.map((s) => ({ label: s.label, lat: s.lat, lng: s.lng })),
          notes: notes.trim() || undefined,
          hirerType,
          renterName: renterName.trim() || undefined,
          renterIdNumber: renterIdNumber.trim() || undefined,
          idDocumentPath: idPath ?? undefined,
          licenseDocumentPath: licensePath ?? undefined,
          rulesAccepted,
        },
      }),
    onSuccess: (row) => {
      setMessage(
        `Request ${row.reference} sent. Estimate KES ${Number(row.estimated_total).toLocaleString("en-KE")} — the owner will confirm.`,
      );
      setStops([]);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const respond = useMutation({
    mutationFn: (vars: { offerId: string; action: "accept" | "decline" }) => respondFn({ data: vars }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hire-quotes"] }),
  });

  const missing: string[] = [];
  if (tab === "self_drive" && !vehicleId) missing.push("choose a vehicle");
  if (!startAt) missing.push("pick a start date");
  if (!pickup) missing.push("set where the car is brought");
  if (!renterName.trim()) missing.push("enter your name");
  if (!idPath) missing.push("upload your ID");
  if (tab === "self_drive" && !licensePath) missing.push("upload your driving licence");
  if (chosen && !rulesAccepted) missing.push("accept the owner's rules");
  if (clash) missing.push("choose free dates");
  const canSubmit = missing.length === 0 && !submit.isPending;

  return (
    <AppShell title="Hire a car">
      <div className="space-y-4 pb-24">
        <div className="flex gap-2">
          {(
            [
              { key: "self_drive", label: "Drive it myself" },
              { key: "chauffeured", label: "Fuelled and chauffeured" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              onClick={() => {
                setTab(o.key);
                setVehicleId(null);
              }}
              className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                tab === o.key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-secondary text-secondary-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* 1. Dates first, so every car shows whether it is free. */}
        <section className="surface-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">When do you need it?</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
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
                inputMode="numeric"
                min={1}
                max={90}
                value={daysText}
                onChange={(e) => setDaysText(e.target.value)}
                onBlur={() => setDaysText(String(days))}
                className="input-base"
              />
            </Field>
          </div>
          {start && endDate ? (
            <p className="mt-2 text-xs text-muted-foreground">
              From {start.toLocaleString("en-KE")} to {endDate.toLocaleString("en-KE")}
            </p>
          ) : null}
        </section>

        {tab === "self_drive" ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-lg font-bold text-foreground">Choose a vehicle</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              All hire cars are shown. Booked dates are marked — pick days when the car is free. You fuel it yourself.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <input
                value={fSeats}
                onChange={(e) => setFSeats(e.target.value)}
                inputMode="numeric"
                placeholder="Min seats"
                className="input-base"
              />
              <select value={fMake} onChange={(e) => setFMake(e.target.value)} className="input-base">
                <option value="">Any make</option>
                {makes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={fModel}
                onChange={(e) => setFModel(e.target.value)}
                placeholder="Model"
                className="input-base"
              />
              <select value={fClass} onChange={(e) => setFClass(e.target.value)} className="input-base">
                <option value="">Any type</option>
                {CLASSES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                value={fMaxPrice}
                onChange={(e) => setFMaxPrice(e.target.value)}
                inputMode="numeric"
                placeholder="Max KES/day"
                className="input-base"
              />
            </div>

            {vehicles.isPending ? <p className="mt-3 text-xs text-muted-foreground">Loading cars…</p> : null}
            {!vehicles.isPending && listed.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No cars match these filters.</p>
            ) : null}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {listed.map((v) => {
                const busy = start ? overlaps(v, start, days) : false;
                return (
                  <article
                    key={v.id}
                    className={`overflow-hidden rounded-2xl border-2 bg-card ${
                      vehicleId === v.id ? "border-primary" : "border-border"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setOpenId(v.id);
                        setPhotoIndex(0);
                        setModalStartDate(start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()) : null);
                      }}
                      className="block w-full text-left"
                    >
                      {v.photo_link ? (
                        <img
                          src={v.photo_link}
                          alt={`${v.make ?? "Car"} ${v.model ?? ""} for hire in Meru`}
                          loading="lazy"
                          className="h-40 w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-40 w-full place-items-center bg-secondary text-xs text-muted-foreground">
                          No photo
                        </div>
                      )}
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {[v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                          </p>
                          {start ? (
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                busy ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"
                              }`}
                            >
                              {busy ? "Booked then" : "Free"}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {v.plate_number} · {v.vehicle_class}
                          {v.seats ? ` · ${v.seats} seats` : ""}
                          {v.photo_links.length > 1 ? ` · ${v.photo_links.length} photos` : ""}
                        </p>
                        <p className="mt-1 font-display text-sm font-bold text-foreground">
                          KES {Number(v.day_rate).toLocaleString("en-KE")} / day
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-primary">View details</p>
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* 2. Hirer details and needs. */}
        <section className="surface-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Your details and needs</h2>
          {chosen ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Selected: {[chosen.make, chosen.model].filter(Boolean).join(" ")} · {chosen.plate_number}
              {start ? ` · KES ${(Number(chosen.day_rate) * days).toLocaleString("en-KE")} for ${days} day(s)` : ""}
            </p>
          ) : null}
          {clash ? (
            <p className="mt-2 rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
              This car is already booked for some of these dates. Choose other dates or another car.
            </p>
          ) : null}

          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              {(
                [
                  { key: "individual", label: "Hiring as a person" },
                  { key: "company", label: "For a company" },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  onClick={() => setHirerType(o.key)}
                  className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                    hirerType === o.key
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-secondary text-secondary-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name">
                <input value={renterName} onChange={(e) => setRenterName(e.target.value)} className="input-base" />
              </Field>
              <Field label="ID / passport number">
                <input
                  value={renterIdNumber}
                  onChange={(e) => setRenterIdNumber(e.target.value)}
                  className="input-base"
                />
              </Field>
            </div>

            {hirerType === "company" ? (
              <Field label="Company or organisation">
                <input
                  value={organisation}
                  onChange={(e) => setOrganisation(e.target.value)}
                  placeholder="Tukuze Afrika Ltd"
                  className="input-base"
                />
              </Field>
            ) : null}

            {tab === "chauffeured" ? (
              <Field label="Vehicle type">
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

            <Field label="Number of people">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                value={peopleText}
                onChange={(e) => setPeopleText(e.target.value)}
                onBlur={() => setPeopleText(String(passengers))}
                className="input-base"
              />
            </Field>
            {chosen?.seats && passengers > chosen.seats ? (
              <p className="text-xs text-destructive">This car has {chosen.seats} seats.</p>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <UploadBox
                label="Your ID (photo)"
                done={Boolean(idPath)}
                busy={uploading === "id"}
                onFile={(f) => void upload("id", f)}
              />
              {tab === "self_drive" ? (
                <UploadBox
                  label="Driving licence (photo)"
                  done={Boolean(licensePath)}
                  busy={uploading === "license"}
                  onFile={(f) => void upload("license", f)}
                />
              ) : null}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Where should the car be brought?</p>
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
                    onPick={(p) => setPickup({ label: p.label, lat: p.lat, lng: p.lng })}
                  />
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Places you plan to visit</p>
              {stops.length ? (
                <ol className="mt-2 space-y-2">
                  {stops.map((s, i) => (
                    <li key={`${s.label}-${i}`} className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.label}</span>
                      <button
                        onClick={() => setStops(stops.filter((_, x) => x !== i))}
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
                  onPick={(p) => setStops((c) => [...c, { label: p.label, lat: p.lat, lng: p.lng }])}
                />
              </div>
            </div>

            <Field label="Anything else we should know?">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input-base" />
            </Field>

            {chosen ? (
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs font-semibold text-foreground">Owner's rules</p>
                <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                  {chosen.hire_rules || "Return the car clean and with the same fuel level. No smoking."}
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs text-foreground">
                  <input type="checkbox" checked={rulesAccepted} onChange={(e) => setRulesAccepted(e.target.checked)} />
                  I have read and accept the owner's rules
                </label>
              </div>
            ) : null}

            <button
              onClick={() => submit.mutate()}
              disabled={!canSubmit}
              className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {submit.isPending ? "Sending…" : tab === "self_drive" ? "Book this car" : "Request a quotation"}
            </button>
            {missing.length && !submit.isPending ? (
              <p className="text-[11px] text-muted-foreground">To continue: {missing.join(", ")}.</p>
            ) : null}
            {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
          </div>
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Your requests</h3>
          {(quotes.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No requests yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {(quotes.data ?? []).map((q) => (
                <li key={q.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{q.reference}</p>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                      {STATUS_COPY[q.status] ?? q.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(q.start_at).toLocaleString("en-KE")} · {q.days} day(s) · {q.passengers} people ·{" "}
                    {q.drive_mode === "self_drive" ? "Self drive" : "With driver"}
                  </p>
                  <p className="mt-1 font-display text-sm font-semibold text-foreground">
                    {q.quoted_total == null
                      ? `Estimate KES ${Number(q.estimated_total).toLocaleString("en-KE")}`
                      : `KES ${Number(q.quoted_total).toLocaleString("en-KE")}`}
                  </p>
                  {q.admin_notes ? <p className="mt-1 text-xs text-muted-foreground">{q.admin_notes}</p> : null}
                  {(q.offers ?? [])
                    .filter((o) => o.status === "offered")
                    .map((o) => (
                      <div key={o.id} className="mt-2 rounded-xl border border-border p-2.5">
                        <p className="text-sm font-semibold text-foreground">
                          Offer: KES {Number(o.price).toLocaleString("en-KE")}
                        </p>
                        {o.note ? <p className="mt-0.5 text-xs text-muted-foreground">{o.note}</p> : null}
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => respond.mutate({ offerId: o.id, action: "accept" })}
                            disabled={respond.isPending}
                            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => respond.mutate({ offerId: o.id, action: "decline" })}
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

      {opened ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/50 sm:items-center"
          onClick={() => setOpenId(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card p-4 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-foreground">
                {[opened.make, opened.model].filter(Boolean).join(" ") || "Vehicle"}
              </h3>
              <button
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className="rounded-full border border-input px-3 py-1 text-xs text-foreground"
              >
                ✕
              </button>
            </div>
            {opened.photo_links.length ? (
              <>
                <img
                  src={opened.photo_links[photoIndex] ?? opened.photo_links[0]}
                  alt={`${opened.make ?? "Car"} ${opened.model ?? ""} photo ${photoIndex + 1}`}
                  className="mt-3 h-56 w-full rounded-2xl object-cover"
                />
                {opened.photo_links.length > 1 ? (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {opened.photo_links.map((src, i) => (
                      <button key={src} onClick={() => setPhotoIndex(i)}>
                        <img
                          src={src}
                          alt={`Thumbnail ${i + 1}`}
                          className={`h-14 w-20 rounded-lg object-cover ${
                            i === photoIndex ? "ring-2 ring-primary" : "opacity-70"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-3 grid h-40 place-items-center rounded-2xl bg-secondary text-xs text-muted-foreground">
                No photos yet
              </div>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Detail k="Plate" v={opened.plate_number} />
              <Detail k="Type" v={opened.vehicle_class} />
              <Detail k="Seats" v={opened.seats ? String(opened.seats) : "—"} />
              <Detail k="Colour" v={opened.colour ?? "—"} />
              <Detail k="Year" v={opened.year ? String(opened.year) : "—"} />
              <Detail k="Price" v={`KES ${Number(opened.day_rate).toLocaleString("en-KE")} / day`} />
            </dl>
            {opened.hire_description ? (
              <p className="mt-3 text-sm text-foreground">{opened.hire_description}</p>
            ) : null}

            <div className="mt-3 rounded-xl border border-border p-3">
              <p className="text-xs font-semibold text-foreground">Owner's rules</p>
              <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                {opened.hire_rules || "Return the car clean and with the same fuel level. No smoking."}
              </p>
            </div>

            <div className="mt-3">
              <p className="text-xs font-semibold text-foreground">Unavailable dates</p>
              {opened.bookings.length ? (
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {opened.bookings.map((b) => (
                    <li key={b.start}>
                      {fmtDate(b.start)} – {fmtDate(b.end)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">No bookings — free any day.</p>
              )}
            </div>

            <AvailabilityCalendar
              key={opened.id}
              vehicle={opened}
              days={days}
              selected={modalStartDate}
              onSelect={setModalStartDate}
            />

            <button
              onClick={() => {
                setVehicleId(opened.id);
                setRulesAccepted(false);
                if (modalStartDate) setStartAt(toLocalDateTime(modalStartDate, start));
                setOpenId(null);
              }}
              disabled={!modalStartDate || overlaps(opened, modalStartDate, days)}
              className="mt-4 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {modalStartDate ? "Start booking with this car" : "Choose an available date first"}
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-2">
      <dt className="text-[10px] text-muted-foreground">{k}</dt>
      <dd className="font-medium text-foreground">{v}</dd>
    </div>
  );
}

function AvailabilityCalendar({
  vehicle,
  days,
  selected,
  onSelect,
}: {
  vehicle: Vehicle;
  days: number;
  selected: Date | null;
  onSelect: (date: Date) => void;
}) {
  const [month, setMonth] = useState(() => {
    const value = selected ?? new Date();
    return new Date(value.getFullYear(), value.getMonth(), 1);
  });
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  return (
    <section className="mt-4 rounded-2xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Choose a free start day</p>
          <p className="text-[10px] text-muted-foreground">Unavailable days are disabled for a {days}-day hire.</p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="rounded-full border border-input px-2.5 py-1 text-sm text-foreground"
          >
            ‹
          </button>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
            className="rounded-full border border-input px-2.5 py-1 text-sm text-foreground"
          >
            ›
          </button>
        </div>
      </div>
      <p className="mt-2 text-center text-xs font-semibold text-foreground">
        {month.toLocaleDateString("en-KE", { month: "long", year: "numeric" })}
      </p>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {[
          ["Su", "Sunday"],
          ["Mo", "Monday"],
          ["Tu", "Tuesday"],
          ["We", "Wednesday"],
          ["Th", "Thursday"],
          ["Fr", "Friday"],
          ["Sa", "Saturday"],
        ].map(([short, full]) => (
          <span key={full} className="py-1 text-[10px] font-medium text-muted-foreground">
            {short}
          </span>
        ))}
        {cells.map((day, index) => {
          if (day === null) return <span key={`blank-${index}`} />;
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const past = date < today;
          const busy = overlaps(vehicle, date, days);
          const isSelected = selected?.toDateString() === date.toDateString();
          const disabled = past || busy;
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              title={busy ? "Unavailable for some of these hire days" : past ? "Past date" : "Available"}
              onClick={() => onSelect(date)}
              className={`aspect-square rounded-lg text-xs font-medium ${
                isSelected && !busy
                  ? "bg-primary text-primary-foreground"
                  : busy
                    ? "cursor-not-allowed bg-destructive/10 text-destructive/70 line-through"
                    : past
                      ? "cursor-not-allowed text-muted-foreground/40"
                      : "border border-success/30 bg-success/5 text-foreground hover:bg-success/15"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
      {selected ? (
        <p className="mt-2 text-center text-[11px] font-medium text-primary">
          Selected: {selected.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
        </p>
      ) : null}
    </section>
  );
}

function toLocalDateTime(date: Date, current: Date | null) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), current?.getHours() ?? 9, current?.getMinutes() ?? 0);
  return new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function UploadBox({
  label,
  done,
  busy,
  onFile,
}: {
  label: string;
  done: boolean;
  busy: boolean;
  onFile: (f: File) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-input px-3 py-3 text-xs">
      <span className="font-medium text-foreground">{label}</span>
      <span className={done ? "text-primary" : "text-muted-foreground"}>
        {busy ? "Uploading…" : done ? "Uploaded ✓" : "Upload"}
      </span>
      <input
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
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

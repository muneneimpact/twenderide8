import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { nextAvailableLabel } from "@/lib/next-available";
import { publicCarsQuery as carsQuery } from "@/lib/public-cars-query";
import { rememberHireVehicle } from "@/lib/hire-selection";
import { recommendHireVehicles } from "@/lib/vehicle-recommendation.functions";
import { submitVehicleInterest } from "@/lib/vehicle-interest.functions";

export const Route = createFileRoute("/cars")({
  head: () => ({
    meta: [
      { title: "Cars for hire in Meru — Twende" },
      {
        name: "description",
        content: "Browse self-drive and chauffeured cars available for hire in Meru. Sign in to book.",
      },
      { property: "og:title", content: "Cars for hire in Meru — Twende" },
      {
        property: "og:description",
        content: "See available hire cars, daily prices and free dates. Sign in to book.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(carsQuery),
  component: CarsPage,
});

type Filter = "all" | "today" | "self" | "driver";
type Sort = "price-asc" | "price-desc";

function CarsPage() {
  const { data: cars } = useSuspenseQuery(carsQuery);
  const recommendFn = useServerFn(recommendHireVehicles);
  const submitInterestFn = useServerFn(submitVehicleInterest);
  const recommendation = useMutation({ mutationFn: (tripNeeds: string) => recommendFn({ data: { tripNeeds } }) });
  const interest = useMutation({
    mutationFn: (data: { contactName: string; contactPhone?: string; contactEmail?: string }) =>
      submitInterestFn({
        data: {
          ...data,
          tripNeeds: tripNeeds.trim(),
          recommendedVehicleIds: recommendation.data?.recommendations.map(({ vehicleId }) => vehicleId) ?? [],
        },
      }),
  });
  const [q, setQ] = useState("");
  const [tripNeeds, setTripNeeds] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("price-asc");
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);
  const now = new Date();
  const shown = cars
    .map((c) => ({ c, avail: nextAvailableLabel(c.bookings, now) }))
    .filter(({ c, avail }) => {
      if (!`${c.make ?? ""} ${c.model ?? ""} ${c.vehicle_class ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "today") return avail.today;
      if (filter === "self") return c.hire_mode !== "chauffeured";
      if (filter === "driver") return c.hire_mode === "chauffeured" || c.hire_mode === "both";
      return true;
    })
    .sort((a, b) => (sort === "price-asc" ? a.c.day_rate - b.c.day_rate : b.c.day_rate - a.c.day_rate));
  const fmt = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
  const chips: Array<[Filter, string]> = [
    ["all", "All"],
    ["today", "Free today"],
    ["self", "Self-drive"],
    ["driver", "With driver"],
  ];

  return (
    <main className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">Cars for hire</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">Browse freely — sign in when you're ready to book.</p>
        </div>
        {signedIn ? (
          <Link to="/book" className="text-xs font-semibold text-primary sm:text-sm">
            Need a ride instead? Book now →
          </Link>
        ) : (
          <Link to="/auth" search={{ redirect: "/book" }} className="text-xs font-semibold text-primary sm:text-sm">
            Need a ride instead? Sign in to book →
          </Link>
        )}
      </header>
      <div className="sticky top-0 z-10 -mx-3 mb-3 space-y-2 bg-background/95 px-3 py-2 backdrop-blur sm:mx-0 sm:px-0">
        <details className="rounded-xl border border-primary/20 bg-primary/5">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold text-foreground [&::-webkit-details-marker]:hidden">
            Not sure which car fits? <span className="ml-1 font-normal text-primary">Ask AI for a quick match</span>
          </summary>
          <form onSubmit={(event) => { event.preventDefault(); if (tripNeeds.trim().length >= 10) recommendation.mutate(tripNeeds.trim()); }} className="border-t border-primary/15 px-3 pb-3 pt-2">
            <p className="text-[11px] text-muted-foreground">Describe your group, dates, budget and driver preference.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <textarea value={tripNeeds} onChange={(event) => setTripNeeds(event.target.value)} minLength={10} maxLength={1200} rows={2} placeholder="E.g. 5 people, 3 days in Meru, luggage, under KES 12,000/day, self-drive" aria-label="Describe your trip needs" className="min-h-16 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <button type="submit" disabled={recommendation.isPending || tripNeeds.trim().length < 10} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{recommendation.isPending ? "Finding a match…" : "Recommend a car"}</button>
          </div>
          {recommendation.isError ? <p className="mt-2 text-xs text-destructive">{(recommendation.error as Error).message}</p> : null}
          {recommendation.data?.recommendations.length ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Best matches</p>
              {recommendation.data.recommendations.map(({ vehicleId, reason, vehicle }) => (
                <Link key={vehicleId} to="/cars/$carId" params={{ carId: vehicleId }} onClick={() => rememberHireVehicle(vehicleId)} className="block rounded-lg border bg-card p-2.5 transition hover:border-primary">
                  <span className="text-sm font-semibold">{vehicle.make} {vehicle.model}</span>
                  <span className="ml-2 text-xs text-muted-foreground">KES {Math.round(vehicle.day_rate).toLocaleString()} / day</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{reason}</span>
                </Link>
              ))}
            </div>
          ) : recommendation.data ? <p className="mt-2 text-xs text-muted-foreground">No listed car matched those needs. Try a wider budget or fewer requirements.</p> : null}
          {tripNeeds.trim().length >= 10 ? (
            <details className="mt-3 border-t border-primary/15 pt-3">
              <summary className="cursor-pointer list-none text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                Want Twende to follow up? <span className="font-normal text-primary">Optional</span>
              </summary>
              <p className="mt-1 text-xs text-muted-foreground">Leave your contact details and the hire team will respond. You can skip this and just use the AI match.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <input value={contactName} onChange={(event) => setContactName(event.target.value)} required placeholder="Your name" className="input-base" />
                <input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="Phone number" inputMode="tel" className="input-base" />
                <input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="Email address" type="email" className="input-base" />
              </div>
              <button
                type="button"
                onClick={() => interest.mutate({ contactName: contactName.trim(), contactPhone: contactPhone.trim() || undefined, contactEmail: contactEmail.trim() || undefined })}
                disabled={interest.isPending || contactName.trim().length < 2 || (!contactPhone.trim() && !contactEmail.trim())}
                className="mt-2 rounded-lg border border-primary px-4 py-2 text-xs font-semibold text-primary disabled:opacity-50"
              >
                {interest.isPending ? "Sending request…" : "Send request to hire team"}
              </button>
              {interest.isSuccess ? <p className="mt-2 text-xs text-primary">Thanks — the hire team has your request and will contact you.</p> : null}
              {interest.isError ? <p className="mt-2 text-xs text-destructive">{(interest.error as Error).message}</p> : null}
            </details>
          ) : null}
          </form>
        </details>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search make, model or type"
            aria-label="Search cars"
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort by price"
            className="shrink-0 rounded-lg border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="price-asc">Cheapest</option>
            <option value="price-desc">Priciest</option>
          </select>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {chips.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                filter === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No cars match right now. Try another filter.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {shown.map(({ c: car, avail }) => (
            <Link
              key={car.id}
              to="/cars/$carId"
              params={{ carId: car.id }}
              aria-label={`View ${car.make} ${car.model}`}
              onClick={() => rememberHireVehicle(car.id)}
              className="group flex overflow-hidden rounded-xl border bg-card shadow-sm transition hover:border-primary hover:shadow-md active:scale-[0.99] sm:flex-col"
            >
              <div className="relative w-28 shrink-0 sm:aspect-video sm:w-full">
                {car.photo_link ? (
                  <img
                    src={car.photo_link}
                    alt={`${car.make} ${car.model}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center sky-gradient text-[10px] text-sky-foreground">
                    No photo
                  </div>
                )}
                {car.photo_links.length > 1 && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-foreground/70 px-1.5 py-0.5 text-[10px] font-semibold text-background">
                    {car.photo_links.length} photos
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1 p-2.5 sm:space-y-2 sm:p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate text-sm font-semibold sm:text-base">
                    {car.make} {car.model} {car.year ? `(${car.year})` : ""}
                  </h2>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-xs ${
                      avail.today ? "bg-primary/10 text-primary" : "bg-coral/15 text-coral"
                    }`}
                  >
                    {avail.label}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {car.seats ? `${car.seats} seats · ` : ""}
                  {car.hire_mode === "chauffeured" ? "With driver" : car.hire_mode === "both" ? "Self-drive or driver" : "Self-drive"}
                  {" · "}
                  {car.hire_deposit_policy && car.hire_deposit_policy !== "none" && Number(car.hire_deposit_amount) > 0
                    ? `Deposit ${fmt(Number(car.hire_deposit_amount))}`
                    : "No deposit"}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-bold sm:text-lg">
                    {fmt(car.day_rate)} <span className="text-xs font-normal text-muted-foreground">/ day</span>
                  </p>
                  <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                    View car
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

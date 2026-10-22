import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listPublicHireVehicles } from "@/lib/hire.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const carsQuery = queryOptions({
  queryKey: ["public-hire-cars"],
  queryFn: () => listPublicHireVehicles(),
  staleTime: 60_000,
});

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

function bookedNow(bookings: Array<{ start: string; end: string }>) {
  const now = Date.now();
  return bookings.some((b) => new Date(b.start).getTime() <= now && new Date(b.end).getTime() > now);
}

function CarsPage() {
  const { data: cars } = useSuspenseQuery(carsQuery);
  const [signedIn, setSignedIn] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);
  const shown = cars.filter((c) =>
    `${c.make ?? ""} ${c.model ?? ""} ${c.vehicle_class ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );
  const fmt = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cars for hire</h1>
          <p className="text-sm text-muted-foreground">Browse freely — sign in when you're ready to book.</p>
        </div>
        <Link to="/" className="text-sm font-semibold text-primary">
          Need a ride instead? Book a ride →
        </Link>
      </header>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search make, model or type"
        aria-label="Search cars"
        className="mb-5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No cars are listed right now. Please check back soon.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((car) => (
            <article key={car.id} className="overflow-hidden rounded-xl border bg-card">
              {car.photo_link ? (
                <img src={car.photo_link} alt={`${car.make} ${car.model}`} className="aspect-video w-full object-cover" loading="lazy" />
              ) : (
                <div className="grid aspect-video place-items-center bg-muted text-xs text-muted-foreground">No photo yet</div>
              )}
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">
                    {car.make} {car.model} {car.year ? `(${car.year})` : ""}
                  </h2>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    {bookedNow(car.bookings) ? "Booked today" : "Available today"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {car.seats ? `${car.seats} seats · ` : ""}
                  {car.hire_mode === "chauffeured" ? "With driver" : car.hire_mode === "both" ? "Self-drive or with driver" : "Self-drive"}
                </p>
                <p className="text-lg font-bold">
                  {fmt(car.day_rate)} <span className="text-xs font-normal text-muted-foreground">/ day</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {car.hire_deposit_policy && car.hire_deposit_policy !== "none" && Number(car.hire_deposit_amount) > 0
                    ? `Refundable deposit ${fmt(Number(car.hire_deposit_amount))}`
                    : "No deposit"}
                </p>
                {signedIn ? (
                  <Button asChild className="w-full">
                    <Link to="/hire">Book this car</Link>
                  </Button>
                ) : (
                  <Button asChild className="w-full">
                    <Link to="/auth" search={{ redirect: "/hire" }}>
                      Sign in to book
                    </Link>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

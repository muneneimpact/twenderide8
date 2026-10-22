import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { nextAvailableLabel } from "@/lib/next-available";
import { publicCarsQuery as carsQuery } from "@/lib/public-cars-query";

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
  const [signedIn, setSignedIn] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("price-asc");
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
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
        <Link to="/" className="text-xs font-semibold text-primary sm:text-sm">
          Need a ride instead? →
        </Link>
      </header>
      <div className="sticky top-0 z-10 -mx-3 mb-3 space-y-2 bg-background/95 px-3 py-2 backdrop-blur sm:mx-0 sm:px-0">
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

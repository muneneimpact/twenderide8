import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, CalendarCheck, CarFront, MapPin, Sparkles, Users } from "lucide-react";
import { getPublicHireBrand } from "@/lib/hire.functions";
import { nextAvailableLabel } from "@/lib/next-available";
import { rememberHireVehicle } from "@/lib/hire-selection";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/$brandSlug")({
  loader: async ({ params }) => {
    const page = await getPublicHireBrand({ data: { slug: params.brandSlug } });
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) => {
    const title = loaderData?.brand.brand_name
      ? `${loaderData.brand.brand_name} — Cars for hire`
      : "Car hire owner page";
    const description =
      loaderData?.brand.marketing_content || loaderData?.brand.business_info ||
      `Explore the cars at ${loaderData?.brand.brand_name ?? "this car-hire page"}, check availability and book securely in Twende.`;
    return {
      meta: [
        { title },
        { name: "description", content: description.slice(0, 160) },
        { property: "og:title", content: title },
        { property: "og:description", content: description.slice(0, 200) },
        { property: "og:image", content: loaderData?.vehicles?.[0]?.photo_link || "/twende-meru-logo-home.png" },
        { property: "og:image:alt", content: `${loaderData?.brand.brand_name ?? "Twende"} hire car page` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: loaderData?.vehicles?.[0]?.photo_link || "/twende-meru-logo-home.png" },
      ],
    };
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="font-display text-xl font-bold text-foreground">Owner page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This brand link may have changed. Browse all available cars instead.
      </p>
      <Link
        to="/cars"
        className="mt-5 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        Browse hire cars
      </Link>
    </main>
  ),
  component: HireBrandPage,
});

function HireBrandPage() {
  const loader = Route.useLoaderData();
  const { brand, owner, vehicles } = loader;
  const promotions = (loader as typeof loader & { promotions?: Array<{ id: string; title: string; description: string; reward_points: number; discount_percent: number; merchandise: string | null }> }).promotions ?? [];
  const [signedIn, setSignedIn] = useState(false);
  const [fleetFilter, setFleetFilter] = useState<"all" | "self_drive" | "chauffeured" | "hourly">("all");
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);
  const isCompany = brand.profile_type === "company";
  const ownerTitle = isCompany ? owner.company_name || brand.brand_name : owner.full_name;
  const profileImage = isCompany ? brand.logo_data_url : owner.avatar_url;
  const trustedBrands = (brand as typeof brand & { trusted_brands?: string[] }).trusted_brands ?? [];
  const filteredVehicles = vehicles.filter((vehicle) => {
    if (fleetFilter === "hourly") return vehicle.hire_hourly_available;
    if (fleetFilter === "self_drive") return !vehicle.hire_mode || vehicle.hire_mode === "self_drive" || vehicle.hire_mode === "both";
    if (fleetFilter === "chauffeured") return vehicle.hire_mode === "chauffeured" || vehicle.hire_mode === "both";
    return true;
  });

  return (
    <main className="min-h-screen bg-secondary/20 pb-12">
      <div className="sticky top-0 z-40 border-b border-border/80 bg-background/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          {brand.logo_data_url ? <img src={brand.logo_data_url} alt={`${brand.brand_name} logo`} className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10" /> : <span className="grid h-9 w-9 shrink-0 place-items-center text-sm font-extrabold text-primary sm:h-10 sm:w-10" aria-hidden="true">{brand.brand_name.slice(0, 1).toUpperCase()}</span>}
          <a href="#owner-fleet" className="min-w-0 truncate font-display text-sm font-extrabold text-foreground sm:text-base">{brand.brand_name}</a>
          <a href="#owner-fleet" className="ml-auto shrink-0 rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground">View cars</a>
        </div>
      </div>
      <header className="relative overflow-hidden bg-primary text-primary-foreground" style={{ background: brand.accent_color ? `linear-gradient(135deg, ${brand.accent_color}, color-mix(in srgb, ${brand.accent_color} 58%, #10251b))` : undefined }}>
        {brand.cover_image_data_url ? <div className="absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: `url(${brand.cover_image_data_url})` }} aria-hidden="true" /> : null}
        <div className="absolute inset-0 opacity-25" aria-hidden="true">
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-brand-foreground/40 blur-3xl" />
          <div className="absolute -bottom-32 left-0 h-72 w-72 rounded-full bg-accent blur-3xl" />
          <div className="absolute right-1/3 top-1/2 h-48 w-48 rounded-full border border-primary-foreground/20" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pb-5 pt-3 sm:px-6 sm:pb-12 sm:pt-10">
          <div className="mt-4 grid items-center gap-7 sm:mt-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
            {brand.logo_data_url ? (
              <img
                src={brand.logo_data_url}
                alt={`${brand.brand_name} logo`}
                className="h-16 w-16 shrink-0 object-contain sm:h-28 sm:w-28"
              />
            ) : (
              <div
                className="hidden"
                aria-label={`${brand.brand_name} logo placeholder`}
              >
                {brand.brand_name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-primary-foreground/75 sm:text-[11px] sm:tracking-[0.2em]">
                <Sparkles className="h-3.5 w-3.5" /> {isCompany ? "A company car-hire profile" : "A personal car-hire experience"} · Supported by Twende
              </p>
              <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight sm:mt-2 sm:text-4xl lg:text-5xl">
                Go places with <span className="text-primary-foreground/80">{brand.brand_name}</span>
              </h1>
              {ownerTitle ? (
                <p className="mt-1 text-xs font-medium text-primary-foreground/85 sm:mt-2 sm:text-sm">{isCompany ? "A car-hire service by " : "Presented by "}{ownerTitle}</p>
              ) : null}
              <p className="mt-1 line-clamp-2 max-w-2xl whitespace-pre-line text-xs leading-relaxed text-primary-foreground/90 sm:mt-3 sm:line-clamp-none sm:text-base">
                {brand.marketing_content || "Find a car that fits your plans, check availability before you book, and keep your booking and payment safely in Twende."}
              </p>
              <a href="#owner-fleet" className="mt-5 hidden w-fit items-center gap-2 rounded-full bg-background px-5 py-3 text-sm font-bold text-primary shadow-lg transition hover:-translate-y-0.5 sm:inline-flex">
                Explore the cars <ArrowDown className="h-4 w-4" />
              </a>
            </div>
            </div>
            <div className="hidden rounded-3xl border border-primary-foreground/20 bg-primary-foreground/10 p-5 backdrop-blur-sm lg:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-foreground/70">Your next trip</p>
              <p className="mt-3 font-display text-2xl font-extrabold">Choose the right car.</p>
              <p className="mt-2 text-xs leading-relaxed text-primary-foreground/80">Browse the collection, find a vehicle that fits your plans, and start with the dates that work for you.</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-7 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:py-9">
        <section id="owner-fleet" className="scroll-mt-6">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">
                Our cars
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the car and service that fit your trip.
              </p>
            </div>
            <span className="hidden rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary sm:inline-flex">Browse the collection</span>
          </div>
          <div aria-label="Filter cars by service" className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {([
              ["all", "All cars"],
              ["self_drive", "Self-drive"],
              ["chauffeured", "With a driver"],
              ["hourly", "By the hour"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={fleetFilter === value}
                onClick={() => setFleetFilter(value)}
                className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold transition ${fleetFilter === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {vehicles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <CarFront className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 font-semibold text-foreground">
                No cars are available right now
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Please check back later. The owner’s page is still available for updates.
              </p>
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
              <p className="text-sm font-semibold text-foreground">No cars match this service yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Try another filter to see the rest of the collection.</p>
              <button type="button" onClick={() => setFleetFilter("all")} className="mt-3 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">Show all cars</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {filteredVehicles.map((vehicle) => {
                const available = nextAvailableLabel(vehicle.bookings, new Date());
                const photo = vehicle.photo_links[0] ?? null;
                const mode =
                  vehicle.hire_mode === "chauffeured"
                    ? "With driver"
                    : vehicle.hire_mode === "both"
                      ? "Self-drive or with driver"
                      : "Self-drive";
                return (
                  <article
                    key={vehicle.id}
                    className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:rounded-2xl"
                  >
                    <Link
                      to="/cars/$carId"
                      params={{ carId: vehicle.id }}
                      search={{ owner: brand.slug }}
                      onClick={() => rememberHireVehicle(vehicle.id)}
                      className="block"
                    >
                      {photo ? (
                        <img
                          src={photo}
                          alt={`${vehicle.make ?? "Hire car"} ${vehicle.model ?? ""}`}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover sm:aspect-[16/10]"
                        />
                      ) : (
                        <div className="grid aspect-[4/3] place-items-center bg-secondary text-[10px] text-muted-foreground sm:aspect-[16/10] sm:text-sm">
                          Photos coming soon
                        </div>
                      )}
                    </Link>
                    <div className="space-y-1.5 p-2 sm:space-y-3 sm:p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 truncate font-display text-xs font-bold text-foreground sm:text-base">
                          {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Hire car"}
                          {vehicle.year ? (
                            <span className="ml-0.5 text-[10px] font-medium text-muted-foreground sm:ml-1 sm:text-sm">
                              ({vehicle.year})
                            </span>
                          ) : null}
                        </h3>
                        <span className="max-w-[45%] shrink-0 truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold text-primary sm:max-w-none sm:px-2.5 sm:py-1 sm:text-[10px]">
                          {available.today ? "Available" : available.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-muted-foreground sm:gap-x-3 sm:text-[11px]">
                        {vehicle.seats ? (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                            {vehicle.seats} seats
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <CarFront className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                          {mode}
                        </span>
                        {vehicle.colour ? <span>{vehicle.colour}</span> : null}
                        {vehicle.hire_hourly_available ? (
                          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 font-semibold text-accent-foreground sm:px-2">Hourly</span>
                        ) : null}
                      </div>
                      {vehicle.hire_description ? (
                        <p className="hidden line-clamp-3 text-xs leading-relaxed text-muted-foreground sm:block">
                          {vehicle.hire_description}
                        </p>
                      ) : null}
                      <div className="flex items-center justify-between gap-1 border-t border-border pt-1.5 sm:pt-3">
                        <p className="font-display text-xs font-extrabold text-foreground sm:text-lg">
                          KES {Math.round(vehicle.day_rate).toLocaleString("en-KE")}
                          <span className="ml-0.5 text-[8px] font-normal text-muted-foreground sm:ml-1 sm:text-[10px]">
                            / day
                          </span>
                        </p>
                        <span className="hidden items-center gap-1 text-[10px] font-semibold text-muted-foreground sm:inline-flex">
                          <CalendarCheck className="h-3.5 w-3.5" /> Check dates
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-2">
                        <Link
                          to="/cars/$carId"
                          params={{ carId: vehicle.id }}
                          search={{ owner: brand.slug }}
                          onClick={() => rememberHireVehicle(vehicle.id)}
                          className="hidden rounded-full border border-input px-3 py-2 text-center text-xs font-semibold text-foreground sm:block"
                        >
                          Car details
                        </Link>
                        {signedIn ? (
                          <Link
                            to="/hire"
                            search={{ owner: brand.slug, vehicle: vehicle.id }}
                            onClick={() => rememberHireVehicle(vehicle.id)}
                            className="rounded-full bg-primary px-1.5 py-1.5 text-center text-[10px] font-semibold text-primary-foreground sm:px-3 sm:py-2 sm:text-xs"
                          >
                            Choose dates
                          </Link>
                        ) : (
                          <Link
                            to="/auth"
                            search={{ redirect: `/hire?owner=${encodeURIComponent(brand.slug)}&vehicle=${encodeURIComponent(vehicle.id)}` }}
                            onClick={() => rememberHireVehicle(vehicle.id)}
                            className="rounded-full bg-primary px-1.5 py-1.5 text-center text-[10px] font-semibold text-primary-foreground sm:px-3 sm:py-2 sm:text-xs"
                          >
                            Sign in to book
                          </Link>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <section className="mt-6 overflow-hidden rounded-3xl border border-border bg-card p-5 sm:p-7">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">A better way to hire</p>
            <h2 className="mt-2 max-w-xl font-display text-xl font-extrabold text-foreground sm:text-2xl">
              A local car, a smoother plan.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Compare the cars in {brand.brand_name}’s collection, see the availability before you request, and keep your booking and payment together in Twende.
            </p>
            <a href="#owner-fleet" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary">
              See the available cars <ArrowRight className="h-4 w-4" />
            </a>
          </section>
        </section>

        <aside className="space-y-4">
          {promotions.length ? <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">From {brand.brand_name}</p><h2 className="mt-1 font-display text-base font-bold text-foreground">Customer promos</h2><div className="mt-3 space-y-2">{promotions.map((promo: { id: string; title: string; description: string; reward_points: number; discount_percent: number; merchandise: string | null }) => <div key={promo.id} className="rounded-xl border border-border bg-card p-3"><p className="text-sm font-semibold text-foreground">{promo.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{promo.description}</p><p className="mt-1 text-[11px] font-bold text-primary">{Number(promo.discount_percent) > 0 ? `${Number(promo.discount_percent)}% discount · ` : ""}{promo.reward_points} points{promo.merchandise ? ` · ${promo.merchandise}` : ""}</p></div>)}</div></section> : null}
          {brand.owner_bio || isCompany ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h2 className="font-display text-base font-bold text-foreground">{isCompany ? "About the company" : "Meet the owner"}</h2>
              <div className="mt-3 flex items-center gap-3">
                {profileImage ? (
                  <img
                    src={profileImage}
                    alt={isCompany ? `${brand.brand_name} logo` : ""}
                    className={`h-11 w-11 object-cover ${isCompany ? "rounded-xl" : "rounded-full"}`}
                  />
                ) : (
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
                    {(ownerTitle || brand.brand_name).slice(0, 1).toUpperCase()}
                  </div>
                )}
                <p className="font-semibold text-foreground">{ownerTitle || brand.brand_name}</p>
              </div>
              {brand.owner_bio ? (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{brand.owner_bio}</p>
              ) : null}
            </section>
          ) : null}
          {brand.business_info ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h2 className="inline-flex items-center gap-2 font-display text-base font-bold text-foreground">
                <MapPin className="h-4 w-4 text-primary" /> Where we operate
              </h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {brand.business_info}
              </p>
            </section>
          ) : null}
          {trustedBrands.length ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h2 className="font-display text-base font-bold text-foreground">Trusted brand experience</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">This owner has permission to show these brands, approved by Twende.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {trustedBrands.map((name: string) => <span key={name} className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">{name}</span>)}
              </div>
            </section>
          ) : null}
          <section className="rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
            <h2 className="font-display text-base font-bold text-foreground">How to book</h2>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>1. Choose a car from this collection.</li>
              <li>2. Select your pickup and return dates to check availability.</li>
              <li>3. Follow the secure booking and payment steps in Twende.</li>
            </ol>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Offline hires and confirmed bookings are reflected in availability. If your selected
              dates are unavailable, the booking page will show the next available date.
            </p>
          </section>
        </aside>
      </div>
      <footer className="border-t border-border px-4 py-5 text-center text-[11px] text-muted-foreground">
        Booking and payment are handled securely through Twende Meru Rides.
      </footer>
    </main>
  );
}

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarCheck, CarFront, MapPin, Users } from "lucide-react";
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
      loaderData?.brand.marketing_content ||
      `Browse hire cars from ${loaderData?.brand.brand_name ?? "this car owner"} and check availability.`;
    return {
      meta: [
        { title },
        { name: "description", content: description.slice(0, 160) },
        { property: "og:title", content: title },
        { property: "og:description", content: description.slice(0, 200) },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
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
  const { brand, owner, vehicles } = Route.useLoaderData();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);
  const ownerTitle = owner.company_name || owner.full_name;

  return (
    <main className="min-h-screen bg-background pb-12">
      <header className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="absolute inset-0 opacity-20" aria-hidden="true">
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-brand-foreground/40 blur-3xl" />
          <div className="absolute -bottom-32 left-0 h-72 w-72 rounded-full bg-accent blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pb-9 pt-6 sm:px-6 sm:pb-12 sm:pt-10">
          <Link
            to="/cars"
            className="inline-flex items-center gap-2 text-xs font-semibold text-primary-foreground/80 hover:text-primary-foreground"
          >
            ← All hire cars
          </Link>
          <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
            {brand.logo_data_url ? (
              <img
                src={brand.logo_data_url}
                alt={`${brand.brand_name} logo`}
                className="h-24 w-24 shrink-0 rounded-2xl bg-background object-contain p-2 shadow-lg sm:h-28 sm:w-28"
              />
            ) : (
              <div
                className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-primary-foreground/15 text-4xl font-extrabold sm:h-28 sm:w-28"
                aria-label={`${brand.brand_name} logo placeholder`}
              >
                {brand.brand_name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="max-w-3xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-foreground/75">
                Car hire · Owner collection
              </p>
              <h1 className="mt-1 font-display text-3xl font-extrabold sm:text-4xl">
                {brand.brand_name}
              </h1>
              {ownerTitle ? (
                <p className="mt-2 text-sm text-primary-foreground/85">{ownerTitle}</p>
              ) : null}
              {brand.marketing_content ? (
                <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-primary-foreground/90 sm:text-base">
                  {brand.marketing_content}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-primary-foreground/15 px-3 py-1.5">
              {vehicles.length} {vehicles.length === 1 ? "car" : "cars"} listed
            </span>
            <span className="rounded-full bg-primary-foreground/15 px-3 py-1.5">
              Check dates before booking
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-7 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:py-9">
        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">
                Cars from {brand.brand_name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Only cars listed by this owner are shown here.
              </p>
            </div>
            <span className="hidden rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary sm:inline-flex">
              {vehicles.length} available listings
            </span>
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
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {vehicles.map((vehicle) => {
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
                    className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
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
                          className="aspect-[16/10] w-full object-cover"
                        />
                      ) : (
                        <div className="grid aspect-[16/10] place-items-center bg-secondary text-sm text-muted-foreground">
                          Photos coming soon
                        </div>
                      )}
                    </Link>
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 font-display text-base font-bold text-foreground">
                          {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Hire car"}
                          {vehicle.year ? (
                            <span className="ml-1 text-sm font-medium text-muted-foreground">
                              ({vehicle.year})
                            </span>
                          ) : null}
                        </h3>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">
                          {available.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {vehicle.seats ? (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {vehicle.seats} seats
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <CarFront className="h-3.5 w-3.5" />
                          {mode}
                        </span>
                        {vehicle.colour ? <span>{vehicle.colour}</span> : null}
                      </div>
                      {vehicle.hire_description ? (
                        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                          {vehicle.hire_description}
                        </p>
                      ) : null}
                      <div className="flex items-center justify-between border-t border-border pt-3">
                        <p className="font-display text-lg font-extrabold text-foreground">
                          KES {Math.round(vehicle.day_rate).toLocaleString("en-KE")}
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                            / day
                          </span>
                        </p>
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                          <CalendarCheck className="h-3.5 w-3.5" /> Check dates
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Link
                          to="/cars/$carId"
                          params={{ carId: vehicle.id }}
                          search={{ owner: brand.slug }}
                          onClick={() => rememberHireVehicle(vehicle.id)}
                          className="rounded-full border border-input px-3 py-2 text-center text-xs font-semibold text-foreground"
                        >
                          Car details
                        </Link>
                        {signedIn ? (
                          <Link
                            to="/hire"
                            search={{ owner: brand.slug }}
                            onClick={() => rememberHireVehicle(vehicle.id)}
                            className="rounded-full bg-primary px-3 py-2 text-center text-xs font-semibold text-primary-foreground"
                          >
                            Choose dates
                          </Link>
                        ) : (
                          <Link
                            to="/auth"
                            search={{ redirect: `/hire?owner=${brand.slug}` }}
                            onClick={() => rememberHireVehicle(vehicle.id)}
                            className="rounded-full bg-primary px-3 py-2 text-center text-xs font-semibold text-primary-foreground"
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
        </section>

        <aside className="space-y-4">
          {brand.owner_bio ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h2 className="font-display text-base font-bold text-foreground">About the owner</h2>
              <div className="mt-3 flex items-center gap-3">
                {owner.avatar_url ? (
                  <img
                    src={owner.avatar_url}
                    alt=""
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : (
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
                    {(ownerTitle || brand.brand_name).slice(0, 1).toUpperCase()}
                  </div>
                )}
                <p className="font-semibold text-foreground">{ownerTitle || brand.brand_name}</p>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {brand.owner_bio}
              </p>
            </section>
          ) : null}
          {brand.business_info ? (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <h2 className="inline-flex items-center gap-2 font-display text-base font-bold text-foreground">
                <MapPin className="h-4 w-4 text-primary" /> Business and service information
              </h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {brand.business_info}
              </p>
            </section>
          ) : null}
          <section className="rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
            <h2 className="font-display text-base font-bold text-foreground">How to book</h2>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>1. Choose a car from this owner.</li>
              <li>2. Select your pickup and return dates to check availability.</li>
              <li>3. Follow the secure booking and payment steps in Twende.</li>
            </ol>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Offline hires and confirmed bookings are reflected in availability. If your selected
              dates are unavailable, the booking page will show the next available date.
            </p>
          </section>
          <Link
            to="/cars"
            className="block rounded-xl border border-border px-4 py-3 text-center text-sm font-semibold text-primary"
          >
            Browse all hire cars
          </Link>
        </aside>
      </div>
      <footer className="border-t border-border px-4 py-5 text-center text-[11px] text-muted-foreground">
        Booking and payment are handled securely through Twende Meru Rides.
      </footer>
    </main>
  );
}

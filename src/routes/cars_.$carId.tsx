import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarCheck, Fuel, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { nextAvailableLabel } from "@/lib/next-available";
import { publicCarsQuery } from "@/lib/public-cars-query";

export const Route = createFileRoute("/cars_/$carId")({
  loader: async ({ context, params }) => {
    const cars = await context.queryClient.ensureQueryData(publicCarsQuery);
    const car = cars.find((c) => c.id === params.carId);
    if (!car) throw notFound();
    return { title: `${car.make ?? ""} ${car.model ?? ""}`.trim() };
  },
  head: ({ loaderData }) => {
    const t = loaderData ? `${loaderData.title} for hire in Meru — Twende` : "Car for hire — Twende";
    return {
      meta: [
        { title: t },
        { name: "description", content: "See photos, daily price, deposit and free dates for this hire car. Sign in to book." },
        { property: "og:title", content: t },
        { property: "og:description", content: "Photos, price and availability for this Twende hire car." },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-md p-8 text-center">
      <p className="font-semibold">This car is no longer listed.</p>
      <Link to="/cars" className="mt-3 inline-block text-primary font-semibold">See other cars</Link>
    </main>
  ),
  component: CarDetail,
});

function CarDetail() {
  const { carId } = Route.useParams();
  const { data: cars } = useSuspenseQuery(publicCarsQuery);
  const car = cars.find((c) => c.id === carId)!;
  const [idx, setIdx] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);
  const photos = car.photo_links;
  const avail = nextAvailableLabel(car.bookings, new Date());
  const fmt = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
  const deposit =
    car.hire_deposit_policy && car.hire_deposit_policy !== "none" && Number(car.hire_deposit_amount) > 0
      ? `${fmt(Number(car.hire_deposit_amount))} refundable${car.hire_deposit_policy === "handover" ? ", paid at handover" : ", paid when booking"}`
      : "No deposit";
  const mode = car.hire_mode === "chauffeured" ? "With driver" : car.hire_mode === "both" ? "Self-drive or with driver" : "Self-drive";
  const features = Array.isArray(car.hire_features) ? (car.hire_features as string[]) : [];

  return (
    <main className="mx-auto max-w-3xl pb-28">
      <div className="relative bg-muted">
        {photos.length ? (
          <img src={photos[idx]} alt={`${car.make} ${car.model} photo ${idx + 1}`} className="aspect-[4/3] w-full object-cover sm:aspect-video" />
        ) : (
          <div className="grid aspect-video place-items-center sky-gradient text-sky-foreground">No photos yet</div>
        )}
        <Link to="/cars" aria-label="Back to cars" className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-background/90 shadow">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {photos.length > 1 && (
          <span className="absolute bottom-3 right-3 rounded-full bg-foreground/70 px-2 py-0.5 text-xs font-semibold text-background">
            {idx + 1} / {photos.length}
          </span>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-3 py-2">
          {photos.map((p, i) => (
            <button key={p} type="button" onClick={() => setIdx(i)} aria-label={`Show photo ${i + 1}`}
              className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${i === idx ? "border-primary" : "border-transparent opacity-70"}`}>
              <img src={p} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <section className="space-y-4 px-4 pt-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">
            {car.make} {car.model} {car.year ? <span className="text-muted-foreground font-semibold">({car.year})</span> : null}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{[car.colour, car.vehicle_class].filter(Boolean).join(" · ")}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl hero-gradient p-3 text-brand-foreground">
            <p className="text-xs opacity-85">Daily price</p>
            <p className="text-xl font-extrabold">{fmt(car.day_rate)}</p>
          </div>
          <div className={`rounded-xl p-3 ${avail.today ? "bg-primary/10 text-primary" : "sunset-gradient text-coral-foreground"}`}>
            <p className="flex items-center gap-1 text-xs opacity-85"><CalendarCheck className="h-3.5 w-3.5" /> Availability</p>
            <p className="text-lg font-bold">{avail.label}</p>
          </div>
        </div>

        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {car.seats ? <li className="flex items-center gap-2 rounded-lg bg-sky/10 p-2.5"><Users className="h-4 w-4 text-sky" /> {car.seats} seats</li> : null}
          <li className="flex items-center gap-2 rounded-lg bg-sky/10 p-2.5"><Fuel className="h-4 w-4 text-sky" /> {mode}</li>
          <li className="flex items-center gap-2 rounded-lg bg-gold/15 p-2.5 sm:col-span-2"><ShieldCheck className="h-4 w-4 text-gold-foreground" /> Deposit: {deposit}</li>
          {car.chauffeur_daily_rate ? <li className="rounded-lg bg-muted p-2.5 sm:col-span-2">Driver add-on: {fmt(Number(car.chauffeur_daily_rate))} / day</li> : null}
        </ul>

        {car.hire_description ? (
          <div>
            <h2 className="mb-1 font-bold">About this car</h2>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{car.hire_description}</p>
          </div>
        ) : null}

        {features.length > 0 && (
          <div>
            <h2 className="mb-2 font-bold">Features</h2>
            <div className="flex flex-wrap gap-2">
              {features.map((f) => (
                <span key={f} className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{f}</span>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">300 km per day included. Plate and owner details are shared after booking.</p>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="font-bold">{fmt(car.day_rate)} <span className="text-xs font-normal text-muted-foreground">/ day</span></p>
          <Button asChild size="lg">
            {signedIn ? <Link to="/hire">Book this car</Link> : <Link to="/auth" search={{ redirect: "/hire" }}>Sign in to book</Link>}
          </Button>
        </div>
      </div>
    </main>
  );
}

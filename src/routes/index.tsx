import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bike, Car, MapPin, ShieldCheck, Wallet } from "lucide-react";

/**
 * Public front door: one screen, two clear choices — get a ride now, or hire a car.
 * Rides stay the dominant option so Twende reads as a taxi app first.
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Twende Meru Rides — Get a ride or hire a car in Meru" },
      {
        name: "description",
        content:
          "Choose how you move in Meru: book a taxi or boda with the fare shown before you request, or hire a self-drive or chauffeured car by the day.",
      },
      { property: "og:title", content: "Twende Meru Rides — Get a ride or hire a car in Meru" },
      {
        property: "og:description",
        content: "Book a taxi across Meru with an upfront fare, or browse cars for hire by the day.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <section className="hero-gradient relative overflow-hidden px-4 pb-14 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6">
        <div className="auth-aurora" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-5xl">
          <p className="auth-rise text-[11px] font-bold uppercase tracking-[0.24em] text-brand-foreground/80">
            Twende Meru Rides
          </p>
          <h1 className="auth-rise auth-delay-1 mt-3 font-display text-4xl font-extrabold leading-[1.05] text-brand-foreground sm:text-5xl">
            Where to next?
          </h1>
          <p className="auth-rise auth-delay-2 mt-3 max-w-lg text-sm leading-relaxed text-brand-foreground/85 sm:text-base">
            Pick how you want to move — grab a taxi across Meru right now, or hire a car for the day.
          </p>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 pt-8 sm:px-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">Choose an option</h2>
        <div className="grid gap-4 sm:grid-cols-[1.12fr_1fr]">
          {/* Rides first and biggest: this is a taxi app before anything else. */}
          <Link
            to="/book"
            className="auth-rise auth-delay-2 group flex min-h-24 items-center gap-4 rounded-2xl border-2 border-primary bg-primary p-5 text-primary-foreground shadow-lg ring-4 ring-primary/15 transition-transform active:scale-[0.98] sm:p-6"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary-foreground/15">
              <Bike className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl font-extrabold">Get a ride</span>
              <span className="mt-1 block text-sm leading-snug opacity-90">
                Taxis and boda across Meru. See the fare before you request.
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 opacity-80 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>

          <Link
            to="/cars"
            className="auth-rise auth-delay-3 group flex min-h-24 items-center gap-4 rounded-2xl border-2 border-primary bg-card p-5 shadow-lg transition-colors hover:bg-primary/5 active:scale-[0.98] sm:p-6"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Car className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-bold text-foreground">Car hire</span>
              <span className="mt-1 block text-sm leading-snug text-muted-foreground">
                Self-drive or chauffeured cars, priced per day. Browse freely — sign in to book.
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-primary opacity-70 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>

        <ul className="mt-6 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Fare shown before you request
          </li>
          <li className="flex items-center gap-2">
            <Wallet className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Pay by M-PESA, wallet or cash
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Live driver tracking
          </li>
        </ul>

        <p className="mt-auto pt-10 text-center text-sm text-muted-foreground">
          <Link to="/auth" search={{ redirect: "/driver/apply" }} className="font-semibold text-primary">
            Drive with Twende? Apply to drive
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" search={{ redirect: "/book" }} className="font-semibold text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

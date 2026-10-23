import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bike, Car, MapPin, ShieldCheck, Sparkles, Wallet } from "lucide-react";

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
  const perks = [
    { icon: ShieldCheck, title: "Upfront fares", text: "See the price before you request.", tone: "bg-primary/10 text-primary" },
    { icon: Wallet, title: "Pay your way", text: "M-PESA, Twende wallet or cash.", tone: "bg-gold/20 text-gold-foreground" },
    { icon: MapPin, title: "Live tracking", text: "Watch your driver arrive.", tone: "bg-sky/15 text-sky" },
    { icon: Sparkles, title: "Rated drivers", text: "Top-rated nearby drivers first.", tone: "bg-coral/15 text-coral" },
  ];
  return (
    <main className="flex h-[100svh] flex-col overflow-hidden bg-background">
      <section className="hero-gradient relative shrink-0 overflow-hidden px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 sm:pb-8">
        <div className="auth-aurora" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full sunset-gradient opacity-40 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full sky-gradient opacity-40 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-5xl">
          <div className="flex items-center justify-between">
            <p className="auth-rise text-[11px] font-bold uppercase tracking-[0.24em] text-brand-foreground/85">
              Twende Meru Rides
            </p>
            <Link to="/auth" search={{ redirect: "/book" }} className="rounded-full bg-brand-foreground/15 px-3 py-1 text-xs font-semibold text-brand-foreground">
              Sign in
            </Link>
          </div>
          <h1 className="auth-rise auth-delay-1 mt-4 font-display text-4xl font-extrabold leading-[1.05] text-brand-foreground sm:text-6xl">
            Where to next,
            <br />
            <span className="text-gold">Meru?</span>
          </h1>
          <p className="auth-rise auth-delay-2 mt-2 max-w-lg text-sm leading-relaxed text-brand-foreground/90 sm:text-base">
            Taxis and boda in minutes, or a car for the whole day — all in one app.
          </p>
        </div>
      </section>

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 pb-4 pt-4 sm:px-6 sm:pt-6">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground sm:text-sm">Choose an option</h2>
        <div className="grid gap-4 sm:grid-cols-[1.12fr_1fr]">
          {/* Rides first and biggest: this is a taxi app before anything else. */}
          <Link
            to="/book"
            className="auth-rise auth-delay-2 group relative flex min-h-24 items-center gap-3 overflow-hidden rounded-3xl border-2 border-primary hero-gradient p-4 text-brand-foreground shadow-xl ring-4 ring-primary/20 transition-transform active:scale-[0.98] sm:min-h-28 sm:p-6"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold text-gold-foreground shadow-md sm:h-14 sm:w-14">
              <Bike className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl font-extrabold sm:text-2xl">Get a ride</span>
              <span className="mt-0.5 block text-xs leading-snug opacity-90 sm:mt-1 sm:text-sm">
                Taxis and boda across Meru. See the fare before you request.
              </span>
            </span>
            <ArrowRight className="h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>

          <Link
            to="/cars"
            className="auth-rise auth-delay-3 group relative flex min-h-24 items-center gap-3 overflow-hidden rounded-3xl border-2 border-sky bg-card p-4 shadow-xl ring-4 ring-sky/15 transition active:scale-[0.98] hover:bg-sky/5 sm:min-h-28 sm:p-6"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl sky-gradient text-sky-foreground shadow-md sm:h-14 sm:w-14">
              <Car className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-extrabold text-foreground sm:text-xl">Car hire</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground sm:mt-1 sm:text-sm">
                Self-drive or with a driver, priced per day. Browse photos freely.
              </span>
            </span>
            <ArrowRight className="h-6 w-6 shrink-0 text-sky transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 sm:mt-8 sm:gap-3">
          {perks.map(({ icon: Icon, title, text, tone }) => (
            <div key={title} className="rounded-2xl border bg-card p-2 shadow-sm sm:p-3">
              <span className={`mb-1 grid h-7 w-7 place-items-center rounded-lg ${tone} sm:mb-2 sm:h-9 sm:w-9 sm:rounded-xl`}>
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
              </span>
              <p className="text-[10px] font-bold leading-tight sm:text-sm">{title}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">{text}</p>
            </div>
          ))}
        </div>

        <Link
          to="/drive-or-list"
          className="mt-3 flex items-center gap-3 rounded-2xl sunset-gradient p-3 text-coral-foreground shadow-lg sm:mt-8 sm:p-4"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-background/20 sm:h-11 sm:w-11">
            <Bike className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold sm:text-base">Drive or list your car with Twende</span>
            <span className="block text-xs opacity-90">Earn on your own schedule. Apply in minutes.</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
        </Link>

        <p className="mt-3 hidden text-center text-xs text-muted-foreground sm:mt-6 sm:block">
          Already have an account?{" "}
          <Link to="/auth" search={{ redirect: "/book" }} className="font-semibold text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

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
  const perks = [
    { icon: ShieldCheck, title: "Upfront fares", text: "See the price before you request.", tone: "bg-primary/10 text-primary" },
    { icon: Wallet, title: "Pay your way", text: "M-PESA, Twende wallet or cash.", tone: "bg-gold/20 text-gold-foreground" },
    { icon: MapPin, title: "Live tracking", text: "Watch your driver arrive.", tone: "bg-sky/15 text-sky" },
    { icon: Sparkles, title: "Rated drivers", text: "Top-rated nearby drivers first.", tone: "bg-coral/15 text-coral" },
  ];
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <section className="hero-gradient relative overflow-hidden px-4 pb-12 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6">
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
          <h1 className="auth-rise auth-delay-1 mt-5 font-display text-4xl font-extrabold leading-[1.05] text-brand-foreground sm:text-6xl">
            Where to next,
            <br />
            <span className="text-gold">Meru?</span>
          </h1>
          <p className="auth-rise auth-delay-2 mt-3 max-w-lg text-sm leading-relaxed text-brand-foreground/90 sm:text-base">
            Taxis and boda in minutes, or a car for the whole day — all in one app.
          </p>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 pt-8 sm:px-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">Choose an option</h2>
        <div className="grid gap-4 sm:grid-cols-[1.12fr_1fr]">
          {/* Rides first and biggest: this is a taxi app before anything else. */}
          <Link
            to="/book"
            className="auth-rise auth-delay-2 group relative flex min-h-28 items-center gap-4 overflow-hidden rounded-3xl border-2 border-primary hero-gradient p-5 text-brand-foreground shadow-xl ring-4 ring-primary/20 transition-transform active:scale-[0.98] sm:p-6"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gold text-gold-foreground shadow-md">
              <Bike className="h-7 w-7" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-2xl font-extrabold">Get a ride</span>
              <span className="mt-1 block text-sm leading-snug opacity-90">
                Taxis and boda across Meru. See the fare before you request.
              </span>
            </span>
            <ArrowRight className="h-6 w-6 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>

          <Link
            to="/cars"
            className="auth-rise auth-delay-3 group relative flex min-h-28 items-center gap-4 overflow-hidden rounded-3xl border-2 border-sky bg-card p-5 shadow-xl ring-4 ring-sky/15 transition active:scale-[0.98] hover:bg-sky/5 sm:p-6"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl sky-gradient text-sky-foreground shadow-md">
              <Car className="h-7 w-7" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl font-extrabold text-foreground">Car hire</span>
              <span className="mt-1 block text-sm leading-snug text-muted-foreground">
                Self-drive or with a driver, priced per day. Browse photos freely.
              </span>
            </span>
            <ArrowRight className="h-6 w-6 shrink-0 text-sky transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {perks.map(({ icon: Icon, title, text, tone }) => (
            <div key={title} className="rounded-2xl border bg-card p-3 shadow-sm">
              <span className={`mb-2 grid h-9 w-9 place-items-center rounded-xl ${tone}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-bold">{title}</p>
              <p className="text-xs text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>

        <Link
          to="/auth"
          search={{ redirect: "/driver/apply" }}
          className="mt-8 flex items-center gap-3 rounded-2xl sunset-gradient p-4 text-coral-foreground shadow-lg"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-background/20">
            <Bike className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Drive or list your car with Twende</span>
            <span className="block text-xs opacity-90">Earn on your own schedule. Apply in minutes.</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
        </Link>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth" search={{ redirect: "/book" }} className="font-semibold text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

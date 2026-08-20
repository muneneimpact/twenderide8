import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Sign in — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Sign in or create a Twende Ride account to book taxis in Meru with the fare shown before you request.",
      },
      { property: "og:title", content: "Sign in — Twende Ride" },
      { property: "og:description", content: "Create an account to book taxis in Meru with upfront fares." },
    ],
  }),
  component: AuthPage,
});

function safePath(value: string | undefined) {
  if (!value) return "/book";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/book";
}

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const destination = safePath(redirect);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) navigate({ to: destination, replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: destination, replace: true });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [destination, navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { full_name: fullName },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice("Check your email and confirm your address to finish creating your account.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center bg-background px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <Link to="/" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Twende Ride
        </Link>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account keeps your ride history, fares and receipts in one place.
        </p>

        <div className="mt-6 flex gap-2 rounded-lg bg-secondary p-1">
          {(["signin", "signup"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMode(key);
                setError(null);
                setNotice(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {key === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          {mode === "signup" && (
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Full name</span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
                minLength={2}
                autoComplete="name"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-foreground">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </main>
  );
}

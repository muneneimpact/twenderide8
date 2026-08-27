import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AuthFormProps {
  eyebrow: string;
  heading: string;
  blurb: string;
  /** Where to land after a successful sign-in. */
  destination: string;
  /** Sign-in only entrances (staff) hide account creation entirely. */
  allowSignUp: boolean;
  signUpCta?: string;
  footer?: React.ReactNode;
}

/**
 * One sign-in surface reused by the customer, driver and staff entrances so
 * each audience only ever sees the door meant for them.
 */
export function AuthForm({
  eyebrow,
  heading,
  blurb,
  destination,
  allowSignUp,
  signUpCta,
  footer,
}: AuthFormProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      if (mode === "signup" && allowSignUp) {
        const normalisedPhone = normaliseKenyanPhone(phone);
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${destination}`,
            data: { full_name: fullName, phone: normalisedPhone },
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
          {eyebrow}
        </Link>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">
          {mode === "signup" ? (signUpCta ?? "Create your account") : heading}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>

        {allowSignUp && (
          <div className="mt-6 flex gap-2 rounded-2xl bg-secondary p-1">
            {(["signin", "signup"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setError(null);
                  setNotice(null);
                }}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  mode === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {key === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="mt-5 space-y-3">
          {allowSignUp && mode === "signup" && (
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Full name</span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
                minLength={2}
                autoComplete="name"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          )}
          {allowSignUp && mode === "signup" && (
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Phone number</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
                placeholder="0712 345 678"
                autoComplete="tel"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                We use this for ride updates and M-PESA payments.
              </span>
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
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
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
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-foreground">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : (signUpCta ?? "Create account")}
          </button>
        </form>

        {footer ? <div className="mt-5 text-xs text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}

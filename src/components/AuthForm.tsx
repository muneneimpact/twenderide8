import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isValidKenyanPhone, maskPhone, normaliseKenyanPhone } from "@/lib/phone";
import { startPhoneLogin, verifyPhoneLogin } from "@/lib/phone-auth.functions";

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
  /**
   * Riders and drivers sign in with an SMS code, which registers and verifies
   * their number in one step. Staff accounts keep email and password.
   */
  method?: "phone" | "password";
}

const input =
  "mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";

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
  method,
}: AuthFormProps) {
  const navigate = useNavigate();
  const channel = method ?? (allowSignUp ? "phone" : "password");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

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

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!isValidKenyanPhone(phone)) {
        throw new Error("Enter a valid Kenyan mobile number, for example 0712 345 678.");
      }
      const result = await startPhoneLogin({ data: { phone: normaliseKenyanPhone(phone) } });
      setStep("code");
      setResendIn(result.resendAfterSeconds);
      setNotice(`We sent a 6-digit code to ${maskPhone(result.phone)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPhoneLogin({
        data: { phone: normaliseKenyanPhone(phone), code, fullName: fullName.trim() || undefined },
      });
      if (!result.verified) {
        setError(`That code is not right. ${result.attemptsLeft} attempt(s) left.`);
        return;
      }
      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: result.tokenHash,
        type: "email",
      });
      if (sessionError) throw sessionError;
      navigate({ to: destination, replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
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
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">{heading}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>

        {channel === "phone" ? (
          step === "phone" ? (
            <form onSubmit={sendCode} className="mt-6 space-y-3">
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
                  className={input}
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  We use this for ride updates and verification.
                </span>
              </label>
              {allowSignUp && (
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">
                    Full name (new accounts only)
                  </span>
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete="name"
                    className={input}
                  />
                </label>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Sending code…" : "Send code by SMS"}
              </button>
              <p className="text-center text-[11px] text-muted-foreground">
                {signUpCta ? "New here? The same code creates your account." : null}
              </p>
            </form>
          ) : (
            <form onSubmit={confirmCode} className="mt-6 space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">6-digit code</span>
                <input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className={`${input} text-center text-lg tracking-[0.5em]`}
                />
              </label>
              {notice && <p className="text-sm text-foreground">{notice}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Verifying…" : "Verify and continue"}
              </button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setCode("");
                    setError(null);
                  }}
                  className="underline"
                >
                  Change number
                </button>
                <button
                  type="button"
                  disabled={busy || resendIn > 0}
                  onClick={() => void sendCode()}
                  className="underline disabled:opacity-50"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                </button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={passwordSignIn} className="mt-6 space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                className={input}
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
                autoComplete="current-password"
                className={input}
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Sign in"}
            </button>
          </form>
        )}

        {footer ? <div className="mt-5 text-xs text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}

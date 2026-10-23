import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isValidKenyanPhone, maskPhone, normaliseKenyanPhone } from "@/lib/phone";
import {
  signInWithPhonePassword,
  startPhoneLogin,
  verifyPhoneLogin,
} from "@/lib/phone-auth.functions";
import { Eye, EyeOff } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

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
   * Riders and drivers sign in with their phone number and password. An SMS code
   * is only used to create the account or to reset a forgotten password. Staff
   * accounts keep email and password.
   */
  method?: "phone" | "password";
}

const input =
  "mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-ring";

/** Password field with an eye button to show or hide what was typed. */
function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${input} pr-11`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

type Mode = "signin" | "signup" | "forgot";

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
  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<"form" | "code">("form");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

  function switchMode(next: Mode) {
    setMode(next);
    setStep("form");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setNotice(null);
  }

  /** Sends the SMS code used to create an account or reset a password. */
  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!isValidKenyanPhone(phone)) {
        throw new Error("Enter a valid Kenyan mobile number, for example 0712 345 678.");
      }
      if (mode !== "forgot" && password.length < 8) {
        throw new Error("Choose a password of at least 8 characters.");
      }
      const result = await startPhoneLogin({ data: { phone: normaliseKenyanPhone(phone) } });
      setStep("code");
      setResendIn(result.resendAfterSeconds);
      setNotice(`We sent a 6-digit code to ${maskPhone(result.phone)}.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not send the code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Confirms the code, then creates the account or stores the new password. */
  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        if (password.length < 8) throw new Error("Choose a password of at least 8 characters.");
        if (password !== confirmPassword) throw new Error("The two passwords do not match.");
      }
      const result = await verifyPhoneLogin({
        data: {
          phone: normaliseKenyanPhone(phone),
          code,
          password,
          intent: mode === "forgot" ? "reset" : "signup",
          fullName: fullName.trim() || undefined,
          email: email.trim() ? email.trim().toLowerCase() : undefined,
        },
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
      // A brand-new account gets trip alerts straight away, without waiting for
      // a trip to arrive first. Declining the browser prompt is not an error.
      if (mode !== "forgot") {
        void import("@/lib/push").then(({ enablePush }) => enablePush()).catch(() => undefined);
      }
      navigate({ to: destination, replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not verify the code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Everyday sign in: phone number plus password, no SMS code needed. */
  async function phonePasswordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!isValidKenyanPhone(phone)) {
        throw new Error("Enter a valid Kenyan mobile number, for example 0712 345 678.");
      }
      const result = await signInWithPhonePassword({
        data: { phone: normaliseKenyanPhone(phone), password },
      });
      if (result.needsPassword) {
        setMode("forgot");
        setStep("form");
        setPassword("");
        setNotice(
          "This account has no password yet. Set one now and we will text you a code to confirm it.",
        );
        return;
      }
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (sessionError) throw sessionError;
      navigate({ to: destination, replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not sign you in. Please try again.",
      );
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
      setError(
        caught instanceof Error ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const signingUp = allowSignUp && mode === "signup";
  const resetting = mode === "forgot";

  return (
    <main className="relative flex h-[100svh] flex-col justify-center overflow-hidden bg-background px-4 py-3 sm:min-h-screen sm:h-auto sm:px-5 sm:py-10">
      <div aria-hidden className="auth-aurora" />
      <div className="relative mx-auto w-full max-w-sm">
        <div className="auth-rise">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" aria-label="Twende Meru home">
              <img
                src="/twende-meru-logo.png"
                alt={eyebrow}
                className="h-10 w-auto object-contain sm:h-14"
              />
            </Link>
            <Link
              to="/"
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Back home
            </Link>
          </div>
          <h1 className="mt-2 font-display text-xl font-semibold tracking-tight text-foreground sm:mt-3 sm:text-2xl">
            {resetting ? "Reset your password" : signingUp ? "Create your account" : heading}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:mt-2 sm:text-sm">
            {resetting
              ? "We text a 6-digit code to your number, then you choose a new password."
              : signingUp
                ? "One Kenyan number, one account. We verify it with a code so your rides and receipts stay yours."
                : blurb}
          </p>
        </div>

        {allowSignUp && channel === "phone" && step === "form" && !resetting ? (
          <div className="auth-rise auth-delay-1 mt-3 grid grid-cols-2 gap-1 rounded-full border border-border bg-secondary p-1 sm:mt-5">
            {(["signin", "signup"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                className={`rounded-full px-3 py-2 text-sm font-semibold transition-all duration-300 ${
                  mode === value
                    ? "bg-primary text-primary-foreground shadow-[0_4px_16px_-6px_rgba(0,0,0,0.45)]"
                    : "text-muted-foreground"
                }`}
              >
                {value === "signin" ? "Sign in" : (signUpCta ?? "Sign up")}
              </button>
            ))}
          </div>
        ) : null}

        {channel === "phone" ? (
          step === "form" ? (
            <form
              key={mode}
              onSubmit={mode === "signin" ? phonePasswordSignIn : sendCode}
              className="mt-4 space-y-2 sm:mt-6 sm:space-y-3"
            >
              <label className="auth-rise auth-delay-1 block">
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

              {signingUp && (
                <>
                  <label className="auth-rise auth-delay-2 block">
                    <span className="text-xs font-medium text-muted-foreground">Full name</span>
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      autoComplete="name"
                      placeholder="Jane Mwende"
                      className={input}
                    />
                  </label>
                  <label className="auth-rise auth-delay-2 block">
                    <span className="text-xs font-medium text-muted-foreground">
                      Email (optional)
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      placeholder="you@example.com"
                      className={input}
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Add it only if you want emailed receipts.
                    </span>
                  </label>
                </>
              )}

              {!resetting && (
                <label className="auth-rise auth-delay-3 block">
                  <span className="text-xs font-medium text-muted-foreground">
                    {mode === "signin" ? "Password" : "Password"}
                  </span>
                  <PasswordInput
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={8}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    placeholder="At least 8 characters"
                  />
                </label>
              )}

              {notice && <p className="auth-rise text-sm text-foreground">{notice}</p>}
              {error && <p className="auth-rise text-sm text-destructive">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="auth-rise auth-delay-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="auth-spinner" />{" "}
                    {mode === "signin" ? "Signing in…" : "Sending code…"}
                  </span>
                ) : mode === "signin" ? (
                  "Sign in"
                ) : resetting ? (
                  "Send code to reset password"
                ) : (
                  "Create account"
                )}
              </button>
              <div className="flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
                {resetting ? (
                  <button type="button" onClick={() => switchMode("signin")} className="underline">
                    Back to sign in
                  </button>
                ) : (
                  <button type="button" onClick={() => switchMode("forgot")} className="underline">
                    Forgot password?
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={confirmCode} className="mt-4 space-y-2 sm:mt-6 sm:space-y-3">
              <label className="auth-rise block">
                <span className="text-xs font-medium text-muted-foreground">6-digit code</span>
                <div className="mt-2 flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={(value) => setCode(value.replace(/\D/g, ""))}
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="^[0-9]*$"
                  >
                    <InputOTPGroup className="gap-2">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          style={{ animationDelay: `${i * 60}ms` }}
                          className={`otp-slot h-12 w-11 rounded-xl border border-input bg-background text-lg font-semibold first:rounded-xl last:rounded-xl ${
                            code[i] ? "otp-filled border-primary" : ""
                          }`}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </label>
              {resetting && (
                <>
                  <label className="auth-rise auth-delay-1 block">
                    <span className="text-xs font-medium text-muted-foreground">New password</span>
                    <PasswordInput
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                    />
                  </label>
                  <label className="auth-rise auth-delay-1 block">
                    <span className="text-xs font-medium text-muted-foreground">
                      Re-enter new password
                    </span>
                    <PasswordInput
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="Type it once more"
                    />
                  </label>
                </>
              )}
              {notice && <p className="auth-rise auth-delay-1 text-sm text-foreground">{notice}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                type="submit"
                disabled={busy || code.length !== 6 || (resetting && password.length < 8)}
                className="auth-rise auth-delay-2 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="auth-spinner" /> {resetting ? "Saving…" : "Verifying…"}
                  </span>
                ) : resetting ? (
                  "Save new password"
                ) : (
                  "Verify and continue"
                )}
              </button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => {
                    setStep("form");

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
          <form onSubmit={passwordSignIn} className="mt-4 space-y-2 sm:mt-6 sm:space-y-3">
            <label className="auth-rise auth-delay-1 block">
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
            <label className="auth-rise auth-delay-2 block">
              <span className="text-xs font-medium text-muted-foreground">Password</span>
              <PasswordInput
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="current-password"
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="auth-rise auth-delay-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Sign in"}
            </button>
          </form>
        )}

        {footer ? <div className="mt-3 text-xs text-muted-foreground sm:mt-5">{footer}</div> : null}
      </div>
    </main>
  );
}

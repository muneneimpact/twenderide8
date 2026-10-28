import { useEffect, useRef, useState } from "react";

export type PayState = "pending" | "paid" | "failed";

/**
 * Full-screen card shown while the customer approves an M-PESA prompt.
 * Polls `check` every 3s; calls `onSuccess` once paid.
 */
export function PaymentProgressCard({
  open,
  attemptKey = 0,
  amount,
  phone,
  check,
  onSuccess,
  onClose,
  onRetry,
  retrying = false,
  successLabel = "Continue",
}: {
  open: boolean;
  attemptKey?: number;
  amount?: number | null | undefined;
  phone?: string | null | undefined;
  check: () => Promise<PayState>;
  onSuccess: () => void;
  onClose: () => void;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
  successLabel?: string;
}) {
  const [state, setState] = useState<PayState>("pending");
  const [secs, setSecs] = useState(0);
  const checkRef = useRef(check);
  checkRef.current = check;

  useEffect(() => {
    if (!open) return;
    setState("pending");
    setSecs(0);
    let stop = false;
    const tick = setInterval(() => setSecs((s) => s + 1), 1000);
    const poll = setInterval(async () => {
      try {
        const s = await checkRef.current();
        if (stop) return;
        if (s !== "pending") {
          setState(s);
          clearInterval(poll);
          clearInterval(tick);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [open, attemptKey]);

  useEffect(() => {
    if (state === "paid") {
      const t = setTimeout(onSuccess, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state, onSuccess]);

  if (!open) return null;
  const slow = state === "pending" && secs > 90;
  const step = state === "paid" ? 3 : secs > 8 ? 2 : 1;
  const steps = [
    "Prompt sent to your phone",
    "Enter your M-PESA PIN on the pop-up",
    "Payment confirmed",
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-foreground/50 p-3 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl">
        <div className="flex flex-col items-center text-center">
          {state === "paid" ? (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-2xl text-success">✓</div>
          ) : state === "failed" ? (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-2xl text-destructive">!</div>
          ) : (
            <div className="h-14 w-14 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          )}
          <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
            {state === "paid" ? "Payment received" : state === "failed" ? "Payment not completed" : "Check your phone"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state === "paid"
              ? "Thank you! Taking you to the next step…"
              : state === "failed"
                ? "The prompt was cancelled, timed out or the PIN was wrong. No money was taken."
                : `An M-PESA prompt${amount ? ` for KES ${Number(amount).toLocaleString("en-KE")}` : ""} was sent${phone ? ` to ${phone}` : ""}. Enter your PIN to approve.`}
          </p>
        </div>
        <ol className="mt-4 space-y-2 text-sm">
          {steps.map((s, i) => {
            const done = i + 1 < step || state === "paid";
            const now = i + 1 === step && state === "pending";
            return (
              <li key={s} className="flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-success text-success-foreground" : now ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={now ? "font-semibold text-foreground" : "text-muted-foreground"}>{s}</span>
              </li>
            );
          })}
        </ol>
        {slow ? (
          <p className="mt-3 rounded-lg bg-warning/10 p-2 text-xs text-warning-foreground">
            Still waiting. If you didn't see the prompt, unlock your phone, or close this and try again.
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          {state === "paid" ? (
            <button onClick={onSuccess} className="flex-1 rounded-full bg-primary px-4 py-2.5 font-semibold text-primary-foreground">{successLabel}</button>
          ) : (
            <>
              {state === "failed" && onRetry ? (
                <button
                  onClick={onRetry}
                  disabled={retrying}
                  className="flex-1 rounded-full bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {retrying ? "Sending new prompt…" : "Try again"}
                </button>
              ) : null}
              <button onClick={onClose} className="flex-1 rounded-full border border-input px-4 py-2.5 font-semibold text-foreground">
                {state === "pending" ? "Hide" : "Close"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

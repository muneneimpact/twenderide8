import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { requestPhoneOtp, verifyPhoneOtp } from "@/lib/otp.functions";
import { useMe } from "@/hooks/useMe";

/**
 * Every signed-in person must confirm ownership of their phone number before
 * using the app. A real six-digit code is sent by SMS (and email when we have
 * an address) — nothing is ever marked verified without the provider accepting
 * the message and the code matching.
 */
export function PhoneVerifyGate({ children }: { children: ReactNode }) {
  const { me, isLoading, refetch, isStaff } = useMe();
  const queryClient = useQueryClient();
  const send = useServerFn(requestPhoneOtp);
  const check = useServerFn(verifyPhoneOtp);

  const profile = me?.profile as { phone?: string | null; phone_verified_at?: string | null } | null | undefined;
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "sent">("idle");

  useEffect(() => {
    if (profile?.phone) setPhone(profile.phone);
  }, [profile?.phone]);

  const sendMutation = useMutation({
    mutationFn: () => send({ data: { phone } }),
    onSuccess: (result) => {
      setError(null);
      setStage("sent");
      const where = [result.sentBySms ? "SMS" : null, result.sentByEmail ? "email" : null]
        .filter(Boolean)
        .join(" and ");
      setNotice(`Code sent by ${where}. It expires in 5 minutes.`);
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => check({ data: { code } }),
    onSuccess: async (result) => {
      if (!result.verified) {
        setError(`That code is not correct. ${result.attemptsLeft} attempts left.`);
        return;
      }
      setError(null);
      setNotice("Phone number verified.");
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await refetch();
    },
    onError: (err: Error) => setError(err.message),
  });

  // Staff sign in with email + password, never by phone. They should not be
  // forced through the customer-facing phone-verification flow.
  if (isStaff) return <>{children}</>;
  if (isLoading || !me) return <>{children}</>;
  if (profile?.phone_verified_at) return <>{children}</>;

  return (
    <div className="mx-auto mt-6 max-w-md px-4">
      <div className="solid-panel space-y-4 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Verify your phone number</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We use this for ride updates and verification. Confirm your number to continue.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Mobile number</label>
          <input
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="0712 345 678"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
        </div>

        {stage === "sent" && (
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm tracking-[0.3em]"
            />
            <button
              onClick={() => verifyMutation.mutate()}
              disabled={code.length !== 6 || verifyMutation.isPending}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {verifyMutation.isPending ? "Checking" : "Verify"}
            </button>
          </div>
        )}

        <button
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending || phone.trim().length < 9}
          className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-foreground disabled:opacity-60"
        >
          {sendMutation.isPending ? "Sending…" : stage === "sent" ? "Send a new code" : "Send verification code"}
        </button>

        {notice && <p className="text-xs text-primary">{notice}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

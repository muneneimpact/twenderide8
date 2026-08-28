import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { requestPhoneOtp, verifyPhoneOtp } from "@/lib/otp.functions";
import { useMe } from "@/hooks/useMe";

/**
 * Shown to any signed-in person whose phone number is not verified yet.
 * Sends a real six-digit code by SMS (and email when available) — nothing is
 * ever marked verified without the provider accepting the message.
 */
export function PhoneVerifyBanner() {
  const { me, refetch } = useMe();
  const queryClient = useQueryClient();
  const send = useServerFn(requestPhoneOtp);
  const check = useServerFn(verifyPhoneOtp);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "sent">("idle");

  const profile = me?.profile as { phone?: string | null; phone_verified_at?: string | null } | null | undefined;
  const phone = profile?.phone ?? null;

  const sendMutation = useMutation({
    mutationFn: () => send({ data: { phone: phone ?? "" } }),
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
    onSuccess: async () => {
      setError(null);
      setNotice("Phone number verified.");
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await refetch();
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!me || !phone || profile?.phone_verified_at) return null;

  return (
    <div className="mx-auto mt-3 max-w-md px-4">
      <div className="solid-panel space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Verify your phone number</p>
          <p className="text-xs text-muted-foreground">
            We use this for ride updates and verification. Code goes to {phone}.
          </p>
        </div>

        {stage === "sent" && (
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm tracking-[0.3em]"
            />
            <button
              onClick={() => verifyMutation.mutate()}
              disabled={code.length !== 6 || verifyMutation.isPending}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {verifyMutation.isPending ? "Checking" : "Verify"}
            </button>
          </div>
        )}

        <button
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending}
          className="w-full rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground disabled:opacity-60"
        >
          {sendMutation.isPending ? "Sending…" : stage === "sent" ? "Send a new code" : "Send verification code"}
        </button>

        {notice && <p className="text-xs text-primary">{notice}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

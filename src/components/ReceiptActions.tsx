import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { emailRideReceipt } from "@/lib/lost-found.functions";

/** Download (print to PDF) or email the receipt of a completed trip. */
export function ReceiptActions({ rideId }: { rideId: string }) {
  const sendFn = useServerFn(emailRideReceipt);
  const [email, setEmail] = useState("");
  const send = useMutation({
    mutationFn: () => sendFn({ data: { rideId, email: email.trim() || undefined } }),
  });
  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4 print:hidden">
      <h3 className="text-sm font-semibold text-foreground">Receipt</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => window.print()}
          className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
        >
          Download receipt
        </button>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email (optional, defaults to yours)"
          className="input-base min-w-0 flex-1"
        />
        <button
          onClick={() => send.mutate()}
          disabled={send.isPending}
          className="rounded-full border border-input px-4 py-2 text-xs font-semibold text-foreground disabled:opacity-50"
        >
          {send.isPending ? "Sending…" : "Email receipt"}
        </button>
      </div>
      {send.isSuccess ? <p className="mt-2 text-xs text-success">Receipt sent to {send.data.to}.</p> : null}
      {send.isError ? <p className="mt-2 text-xs text-destructive">{(send.error as Error).message}</p> : null}
    </section>
  );
}

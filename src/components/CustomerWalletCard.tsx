import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCustomerWallet, listWalletPayouts, requestWalletRefund, reviewWalletPayout } from "@/lib/wallet.functions";

const LABEL: Record<string, string> = {
  ride_credit: "Held from ride with no driver",
  ride_payment: "Paid a retried ride",
  refund_payout: "Refund to M-PESA",
  adjustment: "Adjustment",
};

export function CustomerWalletCard() {
  const qc = useQueryClient();
  const walletFn = useServerFn(getCustomerWallet);
  const refundFn = useServerFn(requestWalletRefund);
  const [phone, setPhone] = useState("");
  const wallet = useQuery({ queryKey: ["customer-wallet"], queryFn: () => walletFn() });
  const refund = useMutation({
    mutationFn: () => refundFn({ data: { phone } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-wallet"] }),
  });
  const balance = wallet.data?.balance ?? 0;
  const entries = wallet.data?.entries ?? [];
  if (!wallet.isLoading && balance === 0 && entries.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your Twende wallet</p>
      <p className="mt-1 text-2xl font-bold text-foreground">KES {balance.toLocaleString("en-KE")}</p>
      <p className="text-xs text-muted-foreground">Money from paid rides that found no driver. Use it to retry the ride, or get it back.</p>
      {balance > 0 && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="M-PESA number, e.g. 0712 345 678"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={() => refund.mutate()}
            disabled={refund.isPending || phone.trim().length < 9}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {refund.isPending ? "Requesting…" : "Refund to M-PESA"}
          </button>
        </div>
      )}
      {refund.isError && <p className="mt-2 text-sm text-destructive">{(refund.error as Error).message}</p>}
      {refund.isSuccess && <p className="mt-2 text-sm text-primary">Refund requested. Finance will send it to your M-PESA.</p>}
      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-border text-sm">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id} className="flex justify-between gap-2 py-2">
              <span className="text-foreground">
                {LABEL[e.kind] ?? e.kind}
                {e.kind === "refund_payout" && <span className="ml-1 text-xs text-muted-foreground">({e.status === "rejected" ? "returned to wallet" : e.status})</span>}
                <span className="block text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("en-KE")}</span>
              </span>
              <span className={`font-semibold ${Number(e.amount) >= 0 ? "text-primary" : "text-foreground"}`}>
                {Number(e.amount) >= 0 ? "+" : "−"}KES {Math.abs(Number(e.amount)).toLocaleString("en-KE")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WalletPayoutsBoard() {
  const listFn = useServerFn(listWalletPayouts);
  const reviewFn = useServerFn(reviewWalletPayout);
  const list = () => listFn();
  const review = (a: { data: { id: string; decision: "paid" | "rejected"; reference?: string | undefined } }) => reviewFn(a as never);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wallet-payouts"], queryFn: list });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: (a: { id: string; decision: "paid" | "rejected" }) => review({ data: { ...a, reference: refs[a.id] } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet-payouts"] }),
  });
  const rows = q.data ?? [];
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Customer wallet refunds</h2>
      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {rows.length === 0 && !q.isLoading && <p className="mt-2 text-sm text-muted-foreground">No wallet refund requests.</p>}
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span className="font-semibold">KES {Math.abs(Number(r.amount)).toLocaleString("en-KE")} → {r.payout_phone}</span>
              <span className="text-xs text-muted-foreground">{r.status}{r.payout_reference ? ` · ${r.payout_reference}` : ""}</span>
            </div>
            {r.status === "pending" && (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input value={refs[r.id] ?? ""} onChange={(e) => setRefs({ ...refs, [r.id]: e.target.value })} placeholder="M-PESA code used" className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" />
                <button onClick={() => act.mutate({ id: r.id, decision: "paid" })} disabled={act.isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Mark paid</button>
                <button onClick={() => act.mutate({ id: r.id, decision: "rejected" })} disabled={act.isPending} className="rounded-md border border-border px-3 py-2 text-sm">Decline</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {act.isError && <p className="mt-2 text-sm text-destructive">{(act.error as Error).message}</p>}
    </section>
  );
}

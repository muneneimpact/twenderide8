import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCustomerWallet, getTopupStatus, listWalletPayouts, payHireFromWallet, payRideFromWallet, requestWalletRefund, reviewWalletPayout, startWalletTopup } from "@/lib/wallet.functions";

const LABEL: Record<string, string> = {
  ride_credit: "Held from ride with no driver",
  ride_payment: "Paid a ride",
  hire_payment: "Paid car hire",
  refund_payout: "Refund to M-PESA",
  wallet_topup: "M-PESA top-up",
  topup_bonus: "Top-up bonus",
  admin_grant: "Gift from Twende",
  adjustment: "Adjustment",
};

const PRESETS = [100, 250, 500, 1000];

function useWallet() {
  const walletFn = useServerFn(getCustomerWallet);
  return useQuery({ queryKey: ["customer-wallet"], queryFn: () => walletFn() });
}

export function CustomerWalletCard() {
  const qc = useQueryClient();
  const refundFn = useServerFn(requestWalletRefund);
  const topupFn = useServerFn(startWalletTopup);
  const statusFn = useServerFn(getTopupStatus);
  const wallet = useWallet();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState(500);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  useEffect(() => {
    if (!phone && wallet.data?.phone) setPhone(wallet.data.phone);
  }, [wallet.data?.phone, phone]);

  const topup = useMutation({
    mutationFn: () => topupFn({ data: { amount, phone } }),
    onSuccess: (r) => setIntentId(r.intentId),
  });
  const status = useQuery({
    queryKey: ["wallet-topup", intentId],
    enabled: Boolean(intentId),
    queryFn: () => statusFn({ data: { intentId: intentId! } }),
    refetchInterval: (q) => (["paid", "failed", "cancelled", "timed_out"].includes(q.state.data?.status ?? "") ? false : 3000),
  });
  useEffect(() => {
    if (status.data?.status === "paid") void qc.invalidateQueries({ queryKey: ["customer-wallet"] });
  }, [status.data?.status, qc]);

  const refund = useMutation({
    mutationFn: () => refundFn({ data: { phone } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-wallet"] }),
  });
  const d = wallet.data;
  const balance = d?.balance ?? 0;
  const entries = d?.entries ?? [];
  const promo = d?.promoConfig;
  const tStatus = status.data?.status;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Twende wallet</p>
      <p className="mt-1 text-3xl font-bold text-foreground">KES {balance.toLocaleString("en-KE")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-secondary p-2">
          <p className="text-muted-foreground">Your money (refundable)</p>
          <p className="font-semibold text-foreground">KES {(d?.refundable ?? 0).toLocaleString("en-KE")}</p>
        </div>
        <div className="rounded-lg bg-secondary p-2">
          <p className="text-muted-foreground">Promo credit (rides & car hire)</p>
          <p className="font-semibold text-foreground">KES {(d?.promo ?? 0).toLocaleString("en-KE")}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-sm font-semibold text-foreground">Add money with M-PESA</p>
        {promo && promo.percent > 0 && (
          <p className="mt-1 text-xs text-primary">
            Wallet promo: get {promo.percent}% bonus when you top up KES {promo.minTopup.toLocaleString("en-KE")} or more (up to KES {promo.cap.toLocaleString("en-KE")}).
          </p>
        )}
        <div className="mt-2 grid grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(p)} className={`rounded-lg border px-2 py-2 text-sm font-semibold ${amount === p ? "border-primary bg-primary text-primary-foreground" : "border-input text-foreground"}`}>
              {p}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(Math.round(Number(e.target.value) || 0))} className="rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-28" aria-label="Amount" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="M-PESA number" className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button onClick={() => topup.mutate()} disabled={topup.isPending || amount < 10 || phone.trim().length < 9} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {topup.isPending ? "Sending…" : "Top up"}
          </button>
        </div>
        {topup.isError && <p className="mt-2 text-sm text-destructive">{(topup.error as Error).message}</p>}
        {intentId && (
          <p className={`mt-2 text-sm ${tStatus === "paid" ? "text-primary" : ["failed", "cancelled", "timed_out"].includes(tStatus ?? "") ? "text-destructive" : "text-muted-foreground"}`}>
            {tStatus === "paid"
              ? "Top-up received. Your wallet is updated."
              : ["failed", "cancelled", "timed_out"].includes(tStatus ?? "")
                ? status.data?.reason ?? "The M-PESA payment did not go through. Nothing was added."
                : "Check your phone and enter your M-PESA PIN. Money is added only after M-PESA confirms."}
          </p>
        )}
      </div>

      {(d?.refundable ?? 0) > 0 && (
        <div className="mt-4">
          {!showRefund ? (
            <button onClick={() => setShowRefund(true)} className="text-xs font-semibold text-muted-foreground underline">Refund my money to M-PESA</button>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => refund.mutate()} disabled={refund.isPending || phone.trim().length < 9} className="rounded-md border border-border px-4 py-2 text-sm font-semibold disabled:opacity-60">
                {refund.isPending ? "Requesting…" : `Refund KES ${(d?.refundable ?? 0).toLocaleString("en-KE")} to ${phone || "M-PESA"}`}
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Promo credit can't be refunded; it pays for rides and car hire.</p>
        </div>
      )}
      {refund.isError && <p className="mt-2 text-sm text-destructive">{(refund.error as Error).message}</p>}
      {refund.isSuccess && <p className="mt-2 text-sm text-primary">Refund requested. Finance will send it to your M-PESA.</p>}

      {entries.length > 0 && (
        <ul className="mt-4 divide-y divide-border text-sm">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id} className="flex justify-between gap-2 py-2">
              <span className="text-foreground">
                {LABEL[e.kind] ?? e.kind}
                {e.refundable === false && <span className="ml-1 rounded bg-secondary px-1 text-[10px] text-muted-foreground">promo</span>}
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

export function PayRideWithWallet({ rideId, fare }: { rideId: string; fare: number }) {
  const qc = useQueryClient();
  const wallet = useWallet();
  const payFn = useServerFn(payRideFromWallet);
  const pay = useMutation({
    mutationFn: () => payFn({ data: { rideId } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const bal = wallet.data?.balance ?? 0;
  if (bal < fare) return bal > 0 ? <p className="mt-2 text-xs text-muted-foreground">Wallet: KES {bal.toLocaleString("en-KE")} — not enough for this ride.</p> : null;
  return (
    <div className="mt-2">
      <button onClick={() => pay.mutate()} disabled={pay.isPending} className="w-full rounded-md border border-primary px-4 py-3 text-sm font-semibold text-primary disabled:opacity-60">
        {pay.isPending ? "Paying…" : `Pay KES ${fare.toLocaleString("en-KE")} from Twende wallet`}
      </button>
      {pay.isError && <p className="mt-1 text-sm text-destructive">{(pay.error as Error).message}</p>}
    </div>
  );
}

export function PayHireWithWallet({ quoteId, amount }: { quoteId: string; amount: number }) {
  const qc = useQueryClient();
  const wallet = useWallet();
  const payFn = useServerFn(payHireFromWallet);
  const pay = useMutation({
    mutationFn: () => payFn({ data: { quoteId, amount } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const bal = wallet.data?.balance ?? 0;
  if (bal < amount || amount <= 0) return null;
  return (
    <>
      <button onClick={() => pay.mutate()} disabled={pay.isPending} className="rounded-full border border-primary px-3 py-2 text-xs font-semibold text-primary disabled:opacity-60">
        {pay.isPending ? "Paying…" : `Pay KES ${amount.toLocaleString("en-KE")} from wallet`}
      </button>
      {pay.isError && <p className="w-full text-xs text-destructive">{(pay.error as Error).message}</p>}
    </>
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

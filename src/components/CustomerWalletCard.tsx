import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCustomerWallet, getTopupStatus, listWalletPayouts, payHireFromWallet, payRideFromWallet, requestWalletRefund, reviewWalletPayout, startWalletTopup } from "@/lib/wallet.functions";
import { confirmWalletPinReset, createWalletPin, getWalletPinStatus, requestWalletPinReset } from "@/lib/wallet-pin.functions";

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

  const [refundAmt, setRefundAmt] = useState("");
  const [refundPin, setRefundPin] = useState("");
  const refund = useMutation({
    mutationFn: () => refundFn({ data: { phone, amount: Number(refundAmt), pin: refundPin } }),
    onSuccess: () => {
      setRefundPin("");
      setShowRefund(false);
      void qc.invalidateQueries({ queryKey: ["customer-wallet"] });
    },
  });
  const d = wallet.data;
  const pendingRefund = (d?.entries ?? []).find((e) => e.kind === "refund_payout" && e.status === "pending");
  const balance = d?.balance ?? 0;
  const entries = d?.entries ?? [];
  const promo = d?.promoConfig;
  const tStatus = status.data?.status;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Twende wallet balance</p>
      <p className="mt-1 text-5xl font-extrabold tracking-tight text-foreground">
        <span className="mr-1 text-2xl font-bold text-muted-foreground">KES</span>
        {balance.toLocaleString("en-KE")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-secondary p-3">
          <p className="text-xs text-muted-foreground">Your money (refundable)</p>
          <p className="mt-1 text-2xl font-bold text-foreground">KES {(d?.refundable ?? 0).toLocaleString("en-KE")}</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="text-xs text-muted-foreground">Promo credit (rides & car hire)</p>
          <p className="mt-1 text-2xl font-bold text-primary">KES {(d?.promo ?? 0).toLocaleString("en-KE")}</p>
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
        {(topup.isPending || intentId) && (
          <TopupProgress
            sending={topup.isPending}
            status={tStatus}
            reason={status.data?.reason ?? null}
            amount={amount}
            onClose={() => setIntentId(null)}
          />
        )}
      </div>

      {pendingRefund && (
        <div className="mt-4 rounded-xl border border-border bg-secondary p-3 text-sm">
          <p className="font-semibold text-foreground">Refund pending: KES {Math.abs(Number(pendingRefund.amount)).toLocaleString("en-KE")}</p>
          <p className="text-xs text-muted-foreground">It stays pending until Twende Finance sends it to your M-PESA.</p>
        </div>
      )}
      {(d?.refundable ?? 0) > 0 && !pendingRefund && (
        <div className="mt-4">
          {!showRefund ? (
            <button onClick={() => { setShowRefund(true); setRefundAmt(String(d?.refundable ?? "")); }} className="text-xs font-semibold text-muted-foreground underline">Refund my money to M-PESA</button>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">
                Amount (up to KES {(d?.refundable ?? 0).toLocaleString("en-KE")})
                <input value={refundAmt} onChange={(e) => setRefundAmt(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
              </label>
              <button type="button" onClick={() => setRefundAmt(String(d?.refundable ?? ""))} className="text-xs font-semibold underline">Use full amount</button>
              <label className="block text-xs text-muted-foreground">
                Wallet PIN
                <input value={refundPin} onChange={(e) => setRefundPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" autoComplete="off" placeholder="••••" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tracking-widest text-foreground" />
              </label>
              <button onClick={() => refund.mutate()} disabled={refund.isPending || phone.trim().length < 9 || refundPin.length !== 4 || !(Number(refundAmt) > 0) || Number(refundAmt) > (d?.refundable ?? 0)} className="w-full rounded-md border border-border px-4 py-2 text-sm font-semibold disabled:opacity-60">
                {refund.isPending ? "Requesting…" : `Refund KES ${Number(refundAmt || 0).toLocaleString("en-KE")} to ${phone || "M-PESA"}`}
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Promo credit can't be refunded; it pays for rides and car hire.</p>
        </div>
      )}
      {refund.isError && <p className="mt-2 text-sm text-destructive">{(refund.error as Error).message}</p>}
      {refund.isSuccess && <p className="mt-2 text-sm text-primary">Refund requested — pending until Finance sends it to your M-PESA.</p>}

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

function TopupProgress({ sending, status, reason, amount, onClose }: { sending: boolean; status: string | undefined; reason: string | null; amount: number; onClose: () => void }) {
  const failed = ["failed", "cancelled", "timed_out"].includes(status ?? "");
  const paid = status === "paid";
  const step = sending ? 0 : paid ? 3 : failed ? -1 : 1;
  const steps = ["Sending M-PESA prompt", "Waiting for your PIN", "Confirming with M-PESA", "Added to wallet"];
  return (
    <div role="status" aria-live="polite" className={`mt-3 rounded-xl border p-3 ${paid ? "border-primary bg-primary/10" : failed ? "border-destructive bg-destructive/10" : "border-border bg-secondary"}`}>
      <div className="flex items-center gap-3">
        {!paid && !failed && <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
        <p className={`text-sm font-semibold ${paid ? "text-primary" : failed ? "text-destructive" : "text-foreground"}`}>
          {paid ? `KES ${amount.toLocaleString("en-KE")} added to your wallet` : failed ? "Top-up didn't go through" : sending ? "Sending the prompt to your phone…" : "Check your phone and enter your M-PESA PIN"}
        </p>
      </div>
      {failed ? (
        <p className="mt-1 text-xs text-muted-foreground">{reason ?? "Nothing was added. You can try again."}</p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {steps.map((s, i) => (
            <li key={s} className={`flex items-center gap-2 text-xs ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${i < step || paid ? "bg-primary text-primary-foreground" : i === step ? "animate-pulse bg-primary/60" : "bg-border"}`}>{i < step || paid ? "✓" : ""}</span>
              {s}
            </li>
          ))}
        </ol>
      )}
      {paid && <p className="mt-2 text-xs text-muted-foreground">We've sent you an SMS and WhatsApp confirmation.</p>}
      {(paid || failed) && <button onClick={onClose} className="mt-2 text-xs font-semibold underline">Close</button>}
    </div>
  );
}

function PinField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={4}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      placeholder="Wallet PIN"
      aria-label="Wallet PIN"
      className="w-28 rounded-md border border-input bg-background px-3 py-2 text-center text-sm tracking-[0.4em]"
    />
  );
}

export function PayRideWithWallet({ rideId, fare }: { rideId: string; fare: number }) {
  const qc = useQueryClient();
  const wallet = useWallet();
  const payFn = useServerFn(payRideFromWallet);
  const [pin, setPin] = useState("");
  const pay = useMutation({
    mutationFn: () => payFn({ data: { rideId, pin } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const bal = wallet.data?.balance ?? 0;
  if (bal < fare) return bal > 0 ? <p className="mt-2 text-xs text-muted-foreground">Wallet: KES {bal.toLocaleString("en-KE")} — not enough for this ride.</p> : null;
  return (
    <div className="mt-2 flex gap-2">
      <PinField value={pin} onChange={setPin} />
      <button onClick={() => pay.mutate()} disabled={pay.isPending || pin.length !== 4} className="flex-1 rounded-md border border-primary px-4 py-3 text-sm font-semibold text-primary disabled:opacity-60">
        {pay.isPending ? "Paying…" : `Pay KES ${fare.toLocaleString("en-KE")} from wallet`}
      </button>
      {pay.isError && <p className="mt-1 w-full text-sm text-destructive">{(pay.error as Error).message}</p>}
    </div>
  );
}

export function PayHireWithWallet({ quoteId, amount }: { quoteId: string; amount: number }) {
  const qc = useQueryClient();
  const wallet = useWallet();
  const payFn = useServerFn(payHireFromWallet);
  const [pin, setPin] = useState("");
  const pay = useMutation({
    mutationFn: () => payFn({ data: { quoteId, amount, pin } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const bal = wallet.data?.balance ?? 0;
  if (bal < amount || amount <= 0) return null;
  return (
    <>
      <PinField value={pin} onChange={setPin} />
      <button onClick={() => pay.mutate()} disabled={pay.isPending || pin.length !== 4} className="rounded-full border border-primary px-3 py-2 text-xs font-semibold text-primary disabled:opacity-60">
        {pay.isPending ? "Paying…" : `Pay KES ${amount.toLocaleString("en-KE")} from wallet`}
      </button>
      {pay.isError && <p className="w-full text-xs text-destructive">{(pay.error as Error).message}</p>}
    </>
  );
}

export function WalletPinCard() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getWalletPinStatus);
  const createFn = useServerFn(createWalletPin);
  const resetFn = useServerFn(requestWalletPinReset);
  const confirmFn = useServerFn(confirmWalletPinReset);
  const status = useQuery({ queryKey: ["wallet-pin"], queryFn: () => statusFn() });
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"idle" | "phone" | "code">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const done = (m: string) => { setMsg(m); setPin(""); setPin2(""); setCode(""); setMode("idle"); void qc.invalidateQueries({ queryKey: ["wallet-pin"] }); };
  const create = useMutation({ mutationFn: () => createFn({ data: { pin } }), onSuccess: () => done("Wallet PIN saved."), onError: (e) => setMsg((e as Error).message) });
  const reset = useMutation({ mutationFn: () => resetFn({ data: { phone } }), onSuccess: () => { setMode("code"); setMsg("Code sent by SMS."); }, onError: (e) => setMsg((e as Error).message) });
  const confirm = useMutation({ mutationFn: () => confirmFn({ data: { code, pin } }), onSuccess: () => done("PIN changed."), onError: (e) => setMsg((e as Error).message) });
  const match = pin.length === 4 && pin === pin2;
  const hasPin = status.data?.hasPin;
  return (
    <section className="mt-3 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">Wallet PIN</p>
      {status.isLoading ? null : !hasPin ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">Create a 4-digit PIN. You'll enter it every time you pay from your wallet.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <PinField value={pin} onChange={setPin} />
            <PinField value={pin2} onChange={setPin2} />
            <button onClick={() => create.mutate()} disabled={!match || create.isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">Save PIN</button>
          </div>
        </>
      ) : mode === "idle" ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">PIN is set{status.data?.lockedUntil && new Date(status.data.lockedUntil) > new Date() ? " — locked after wrong tries" : ""}.</p>
          <button onClick={() => { setMode("phone"); setMsg(null); }} className="rounded-md border border-border px-3 py-2 text-xs font-semibold">Change PIN</button>
        </div>
      ) : mode === "phone" ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Your account phone number" className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button onClick={() => reset.mutate()} disabled={reset.isPending || phone.trim().length < 9} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{reset.isPending ? "Sending…" : "Send code"}</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <PinField value={pin} onChange={setPin} />
          <PinField value={pin2} onChange={setPin2} />
          <button onClick={() => confirm.mutate()} disabled={!match || code.length !== 6 || confirm.isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">Set new PIN</button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
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

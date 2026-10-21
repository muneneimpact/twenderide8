import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  listOwnerBookings,
  markHireHandover,
  requestHandoverDeposit,
  ownerConfirmCompanyBooking,
  ownerDeclineHire,
  ownerApplySavedSignature,
  type OwnerBooking,
} from "@/lib/hire-owner.functions";
import { requestHirePaymentReminder } from "@/lib/hire.functions";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function stage(b: OwnerBooking) {
  if (b.returned_at) return { label: "Returned", tone: "bg-secondary text-muted-foreground" };
  if (b.handed_over_at) return { label: "On hire", tone: "bg-primary/15 text-primary" };
  if (b.status === "submitted" && b.pay_later)
    return { label: "Verify company", tone: "bg-warning/15 text-warning" };
  if (b.status === "confirmed") return { label: "Ready to hand over", tone: "bg-success/15 text-success" };
  return { label: "Awaiting payment", tone: "bg-warning/15 text-warning" };
}

/** Owner/driver view of booked days with one-tap handover and return. */
export function OwnerHireBookings() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOwnerBookings);
  const handFn = useServerFn(markHireHandover);
  const declineFn = useServerFn(ownerDeclineHire);
  const signFn = useServerFn(ownerApplySavedSignature);
  const depositFn = useServerFn(requestHandoverDeposit);
  const verifyFn = useServerFn(ownerConfirmCompanyBooking);
  const depositReq = useMutation({
    mutationFn: (quoteId: string) => depositFn({ data: { quoteId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["owner-hire-bookings"] }),
    onError: (e: Error) => setErr(e.message),
  });
  const q = useQuery({ queryKey: ["owner-hire-bookings"], queryFn: () => listFn(), refetchInterval: 30_000 });
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState<string | null>(null);
  const [ret, setRet] = useState({ deposit: "", km: "", fuel: "0", fines: "0", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["owner-hire-bookings"] });
  const hand = useMutation({
    mutationFn: (v: {
      quoteId: string;
      step: "handed_over" | "returned";
      settlement?: { deposit: number; kmDriven: number; fuelCharge: number; penalties: number; notes?: string | undefined };
    }) => handFn({ data: v }),
    onSuccess: () => {
      setReturning(null);
      refresh();
    },
    onError: (e) => setErr((e as Error).message),
  });
  const decline = useMutation({
    mutationFn: (quoteId: string) => declineFn({ data: { quoteId, reason } }),
    onSuccess: () => {
      setDeclining(null);
      setReason("");
      refresh();
    },
    onError: (e) => setErr((e as Error).message),
  });

  const sign = useMutation({
    mutationFn: (quoteId: string) => signFn({ data: { quoteId } }),
    onSuccess: refresh,
    onError: (e) => setErr((e as Error).message),
  });
  const verify = useMutation({
    mutationFn: (quoteId: string) => verifyFn({ data: { quoteId } }),
    onSuccess: refresh,
    onError: (e) => setErr((e as Error).message),
  });
  const remindFn = useServerFn(requestHirePaymentReminder);
  const remind = useMutation({
    mutationFn: (vars: { quoteId: string; amount: number }) =>
      remindFn({ data: { ...vars, channels: ["sms", "email", "whatsapp"] } }),
    onSuccess: (r) => {
      setErr(null);
      refresh();
      if (!r.accepted) setErr(r.message);
    },
    onError: (e) => setErr((e as Error).message),
  });
  const SignTick = ({ b }: { b: OwnerBooking }) => (
    <label className="mt-2 flex items-center gap-2 rounded-lg bg-secondary/50 p-2">
      <input
        type="checkbox"
        checked={b.owner_signed}
        disabled={b.owner_signed || sign.isPending}
        onChange={() => sign.mutate(b.id)}
        className="h-4 w-4 accent-primary"
      />
      <span className="font-medium text-foreground">
        {b.owner_signed ? "✓ Your signature is on the agreement" : "Tick to add your saved signature"}
      </span>
      <span className="ml-auto text-muted-foreground">
        Hirer {b.hirer_signed ? "✓" : "—"}{b.agreement_completed ? " · Complete" : ""}
      </span>
    </label>
  );

  const rows = q.data ?? [];
  const upcoming = rows.filter((b) => !b.returned_at);
  const past = rows.filter((b) => b.returned_at);

  return (
    <section className="surface-card p-4">
      <h2 className="font-display text-lg font-semibold text-foreground">Bookings & handovers</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Your hired days at a glance. Check the renter before pickup — you may decline up to 12 hours
        before pickup, or within 3 hours of a short-notice booking.
      </p>
      {q.isPending ? <p className="mt-3 text-xs text-muted-foreground">Loading…</p> : null}
      {q.isSuccess && !upcoming.length ? (
        <p className="mt-3 text-xs text-muted-foreground">No upcoming hires.</p>
      ) : null}
      <ul className="mt-3 space-y-3">
        {upcoming.map((b) => {
          const s = stage(b);
          return (
            <li key={b.id} className="rounded-xl border border-border p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{b.vehicle}</p>
                  <p className="text-muted-foreground">{b.reference} · {b.renter}{b.hirer_type === "company" ? " (company)" : ""}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${s.tone}`}>{s.label}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-secondary/50 p-2">
                <div><p className="text-muted-foreground">Pickup</p><p className="font-medium text-foreground">{fmt(b.start_at)}</p></div>
                <div><p className="text-muted-foreground">Return</p><p className="font-medium text-foreground">{b.end_at ? fmt(b.end_at) : `${b.days} day(s)`}</p></div>
              </div>
              <p className="mt-2 text-muted-foreground">
                {b.days} day(s) · {b.drive_mode === "self_drive" ? "Self drive" : "Chauffeured"} · KES {b.total.toLocaleString("en-KE")} · paid KES {b.paid.toLocaleString("en-KE")}
                {b.pay_later ? ` · pays ${b.pay_later}` : ""}
                {b.has_documents ? " · ID on file" : ""}
              </p>
              {b.pay_later ? (
                <div className="mt-2 rounded-xl border border-border bg-secondary/40 p-2">
                  <p className="font-semibold text-foreground">
                    Company pay-later {b.company_verified ? "· verified ✓" : "· waiting for your verification"}
                  </p>
                  {b.business_email ? <p className="text-muted-foreground">Email: {b.business_email}</p> : null}
                  {b.business_registration ? <p className="text-muted-foreground">Reg. no: {b.business_registration}</p> : null}
                  {b.kyc.length ? (
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {b.kyc.map((doc) => (
                        <a key={doc.kind} href={doc.url} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
                          {doc.label}
                        </a>
                      ))}
                    </p>
                  ) : (
                    <p className="mt-1 text-destructive">No business documents uploaded yet.</p>
                  )}
                </div>
              ) : null}
              {b.renter_phone ? (
                <a href={`tel:${b.renter_phone}`} className="mt-1 inline-block font-semibold text-primary">Call renter {b.renter_phone}</a>
              ) : null}
              <p className="mt-1 font-medium text-foreground">
                {b.deposit_policy === "none" || b.deposit_amount <= 0
                  ? "No deposit"
                  : b.deposit_policy === "upfront"
                    ? `Refundable deposit KES ${b.deposit_amount.toLocaleString("en-KE")} — paid at booking`
                    : b.deposit_requested
                      ? b.paid >= b.total
                        ? `Refundable deposit KES ${b.deposit_amount.toLocaleString("en-KE")} — paid`
                        : `Waiting for hirer to pay the KES ${b.deposit_amount.toLocaleString("en-KE")} deposit`
                      : `Refundable deposit KES ${b.deposit_amount.toLocaleString("en-KE")} — due at pickup`}
              </p>
              <SignTick b={b} />
              <div className="mt-2 flex flex-wrap gap-2">
                {b.status === "submitted" && b.pay_later ? (
                  <button
                    onClick={() => verify.mutate(b.id)}
                    disabled={verify.isPending || b.kyc.length === 0}
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {verify.isPending ? "Verifying…" : "Verify company & confirm booking"}
                  </button>
                ) : null}
                <Link to="/hire/agreement/$quoteId" params={{ quoteId: b.id }} hash="sign" className="rounded-full border border-primary px-3 py-2 font-semibold text-primary">
                  {b.status === "confirmed" && !b.handed_over_at ? "Walkaround, sign & agreement" : "Sign / agreement"}
                </Link>
                {b.status === "confirmed" && !b.handed_over_at && b.deposit_policy === "handover" && b.deposit_amount > 0 && !b.deposit_requested ? (
                  <button onClick={() => depositReq.mutate(b.id)} disabled={depositReq.isPending} className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                    Ask hirer to pay KES {b.deposit_amount.toLocaleString("en-KE")} deposit
                  </button>
                ) : null}
                {b.status === "confirmed" && !b.handed_over_at && !(b.deposit_policy === "handover" && b.deposit_amount > 0 && (!b.deposit_requested || b.paid < b.total)) ? (
                  <button onClick={() => hand.mutate({ quoteId: b.id, step: "handed_over" })} disabled={hand.isPending} className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                    Hand over car
                  </button>
                ) : null}
                {b.handed_over_at && !b.returned_at ? (
                  <button onClick={() => { setReturning(returning === b.id ? null : b.id); setRet((r) => ({ ...r, deposit: b.deposit_policy === "none" ? "0" : String(b.deposit_amount) })); }} disabled={hand.isPending} className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                    Car returned
                  </button>
                ) : null}
                {b.can_decline ? (
                  <button onClick={() => setDeclining(declining === b.id ? null : b.id)} className="rounded-full border border-destructive px-3 py-2 font-semibold text-destructive">
                    Decline hire
                  </button>
                ) : null}
              </div>
              {returning === b.id ? (
                <div className="mt-2 grid gap-2 rounded-xl border border-border p-3">
                  <p className="font-semibold">Return check — the renter gets an SMS with what was kept and returned</p>
                  {([
                    ["deposit", "Deposit held (KES)"],
                    ["km", "Km driven this hire"],
                    ["fuel", "Missing fuel charge (KES)"],
                    ["fines", "Traffic / parking fines (KES)"],
                  ] as const).map(([k, l]) => (
                    <label key={k} className="grid gap-1 text-sm">
                      {l}
                      <input inputMode="numeric" value={ret[k]} onChange={(e) => setRet({ ...ret, [k]: e.target.value.replace(/[^0-9.]/g, "") })} className="input-base" />
                    </label>
                  ))}
                  <input value={ret.notes} onChange={(e) => setRet({ ...ret, notes: e.target.value })} placeholder="Notes (optional)" className="input-base" />
                  <p className="text-xs text-muted-foreground">300 km a day is included; extra km is KES 30 each.</p>
                  <button
                    disabled={hand.isPending || ret.deposit === "" || ret.km === ""}
                    onClick={() =>
                      hand.mutate({
                        quoteId: b.id,
                        step: "returned",
                        settlement: { deposit: Number(ret.deposit), kmDriven: Number(ret.km), fuelCharge: Number(ret.fuel || 0), penalties: Number(ret.fines || 0), notes: ret.notes || undefined },
                      })
                    }
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Confirm return & send summary
                  </button>
                </div>
              ) : null}
              {declining === b.id ? (
                <div className="mt-2 flex gap-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shared with Twende)" className="input-base flex-1" />
                  <button onClick={() => decline.mutate(b.id)} disabled={reason.trim().length < 5 || decline.isPending} className="rounded-full bg-destructive px-3 py-2 font-semibold text-destructive-foreground disabled:opacity-50">
                    Confirm
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {past.length ? (
        <details open className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">Completed hires ({past.length})</summary>
          <ul className="mt-2 space-y-2 text-muted-foreground">
            {past.map((b) => (
              <li key={b.id} className="rounded-lg border border-border p-2">
                <p>{b.vehicle} · {b.renter} · {fmt(b.start_at)} · KES {b.total.toLocaleString("en-KE")}</p>
                <SignTick b={b} />
                <Link to="/hire/agreement/$quoteId" params={{ quoteId: b.id }} className="mt-1 inline-block font-semibold text-primary">Open agreement</Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
    </section>
  );
}

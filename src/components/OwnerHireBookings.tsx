import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  listOwnerBookings,
  markHireHandover,
  ownerDeclineHire,
  type OwnerBooking,
} from "@/lib/hire-owner.functions";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function stage(b: OwnerBooking) {
  if (b.returned_at) return { label: "Returned", tone: "bg-secondary text-muted-foreground" };
  if (b.handed_over_at) return { label: "On hire", tone: "bg-primary/15 text-primary" };
  if (b.status === "confirmed") return { label: "Ready to hand over", tone: "bg-success/15 text-success" };
  return { label: "Awaiting payment", tone: "bg-warning/15 text-warning" };
}

/** Owner/driver view of booked days with one-tap handover and return. */
export function OwnerHireBookings() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOwnerBookings);
  const handFn = useServerFn(markHireHandover);
  const declineFn = useServerFn(ownerDeclineHire);
  const q = useQuery({ queryKey: ["owner-hire-bookings"], queryFn: () => listFn(), refetchInterval: 30_000 });
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["owner-hire-bookings"] });
  const hand = useMutation({
    mutationFn: (v: { quoteId: string; step: "handed_over" | "returned" }) => handFn({ data: v }),
    onSuccess: refresh,
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
              {b.renter_phone ? (
                <a href={`tel:${b.renter_phone}`} className="mt-1 inline-block font-semibold text-primary">Call renter {b.renter_phone}</a>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link to="/hire/agreement/$quoteId" params={{ quoteId: b.id }} hash="sign" className="rounded-full border border-primary px-3 py-2 font-semibold text-primary">
                  {b.status === "confirmed" && !b.handed_over_at ? "Walkaround, sign & agreement" : "Sign / agreement"}
                </Link>
                {b.status === "confirmed" && !b.handed_over_at ? (
                  <button onClick={() => hand.mutate({ quoteId: b.id, step: "handed_over" })} disabled={hand.isPending} className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                    Hand over car
                  </button>
                ) : null}
                {b.handed_over_at && !b.returned_at ? (
                  <button onClick={() => hand.mutate({ quoteId: b.id, step: "returned" })} disabled={hand.isPending} className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">
                    Car returned
                  </button>
                ) : null}
                {b.can_decline ? (
                  <button onClick={() => setDeclining(declining === b.id ? null : b.id)} className="rounded-full border border-destructive px-3 py-2 font-semibold text-destructive">
                    Decline hire
                  </button>
                ) : null}
              </div>
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
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">Completed hires ({past.length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {past.map((b) => (
              <li key={b.id}>{b.vehicle} · {b.renter} · {fmt(b.start_at)} · KES {b.total.toLocaleString("en-KE")}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
    </section>
  );
}

import { Link } from "@tanstack/react-router";
import { useState } from "react";

type Q = {
  id: string;
  reference: string;
  hirer_type: string;
  status: string;
  payment_status: string;
  payment_paid_total: number | string | null;
  estimated_total: number | string;
  quoted_total: number | string | null;
  agreement_signed_at: string | null;
  owner_signed_at: string | null;
  start_at: string;
  end_at: string | null;
  returned_at: string | null;
  handed_over_at: string | null;
  pay_later_due_date: string | null;
  owner_declined_at: string | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

export function nextAction(q: Q): string {
  if (q.owner_declined_at || ["declined", "cancelled", "rejected"].includes(q.status)) return "Closed — book another car";
  if (q.returned_at) return "Download agreement & receipt";
  if (!q.agreement_signed_at) return "Sign the agreement";
  if (q.status === "submitted" && q.pay_later_due_date) return "Waiting for owner to verify your company";
  if (!q.pay_later_due_date && !["paid", "partial"].includes(q.payment_status)) return "Pay to confirm the booking";
  if (!q.owner_signed_at) return "Waiting for owner to sign";
  if (!q.handed_over_at) return "Pick up the car";
  if (q.pay_later_due_date && q.payment_status !== "paid") return `Pay by ${q.pay_later_due_date}`;
  return "Return the car on time";
}

/** Company hirer overview: every booking with agreement, payment and the next step. */
export function CompanyBookingsDashboard({ quotes }: { quotes: Q[] }) {
  const [tab, setTab] = useState<"active" | "past">("active");
  const company = quotes.filter((q) => q.hirer_type === "company");
  if (!company.length) return null;
  const isPast = (q: Q) => Boolean(q.returned_at) || Boolean(q.owner_declined_at) || ["declined", "cancelled", "rejected", "completed"].includes(q.status);
  const list = company.filter((q) => (tab === "past" ? isPast(q) : !isPast(q)));
  return (
    <section className="surface-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-foreground">Company bookings</h2>
        <div className="flex rounded-full bg-secondary p-0.5 text-xs">
          {(["active", "past"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 font-semibold ${tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
              {t === "active" ? "Active" : "Past"}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">No {tab} bookings.</p> : null}
      <ul className="mt-3 space-y-2">
        {list.map((q) => {
          const total = Number(q.quoted_total ?? q.estimated_total);
          const paid = Number(q.payment_paid_total ?? 0);
          const both = Boolean(q.agreement_signed_at && q.owner_signed_at);
          return (
            <li key={q.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{q.reference}</span>
                <span className="text-xs text-muted-foreground">{new Date(q.start_at).toLocaleDateString("en-KE")}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-secondary/60 p-2">
                  <p className="text-muted-foreground">Agreement</p>
                  <p className="font-medium text-foreground">{both ? "Signed by both" : q.agreement_signed_at ? "Owner to sign" : "You to sign"}</p>
                </div>
                <div className="rounded-lg bg-secondary/60 p-2">
                  <p className="text-muted-foreground">Payment</p>
                  <p className="font-medium text-foreground">
                    {q.payment_status === "paid" ? "Paid" : q.pay_later_due_date ? `Pay later · due ${q.pay_later_due_date}` : `${kes(paid)} of ${kes(total)}`}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-primary">Next: {nextAction(q)}</p>
                <Link to="/hire/agreement/$quoteId" params={{ quoteId: q.id }} className="rounded-full border border-input px-3 py-1 text-xs font-semibold text-foreground">
                  Open
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

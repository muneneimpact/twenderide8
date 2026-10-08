import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import {
  decideHireQuote,
  getHireCommissionAdmin,
  listHireQuotes,
  updateHireCommissionPercent,
} from "@/lib/hire.functions";

export const Route = createFileRoute("/_authenticated/admin/hire")({
  head: () => ({
    meta: [
      { title: "Hire and corporate quotations | Twende Meru Rides" },
      {
        name: "description",
        content:
          "Review hire and corporate requests, manage the default commission, and monitor payments.",
      },
      { property: "og:title", content: "Hire and corporate quotations | Twende Meru Rides" },
      { property: "og:description", content: "Ops queue for hire requests and payments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminHirePage,
});

function AdminHirePage() {
  return (
    <RoleGate allow={["ops_admin", "super_admin"]} title="Hire requests">
      <AdminHireBoard />
    </RoleGate>
  );
}

function AdminHireBoard() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listHireQuotes);
  const decideFn = useServerFn(decideHireQuote);
  const commissionFn = useServerFn(getHireCommissionAdmin);
  const updateCommissionFn = useServerFn(updateHireCommissionPercent);
  const quotes = useQuery({ queryKey: ["admin-hire-quotes"], queryFn: () => listFn() });
  const commission = useQuery({
    queryKey: ["admin-hire-commission"],
    queryFn: () => commissionFn(),
  });
  const [drafts, setDrafts] = useState<Record<string, { price: string; note: string }>>({});
  const [commissionDraft, setCommissionDraft] = useState("7");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (commission.data) setCommissionDraft(String(commission.data.commissionPercent));
  }, [commission.data]);

  const decide = useMutation({
    mutationFn: (vars: {
      id: string;
      status: "quoted" | "confirmed" | "declined";
      quotedTotal?: number | null;
      adminNotes?: string | undefined;
    }) => decideFn({ data: vars }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-hire-quotes"] }),
    onError: (error) => setNotice((error as Error).message),
  });

  const saveCommission = useMutation({
    mutationFn: () => updateCommissionFn({ data: { percent: Number(commissionDraft) } }),
    onSuccess: (result) => {
      setNotice(
        `Default hire commission updated to ${result.percent}%. Existing bookings retain their locked rate.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-hire-commission"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const totals = commission.data;
  const rows = quotes.data ?? [];
  return (
    <AppShell title="Hire requests">
      <div className="space-y-3 pb-24">
        <section className="surface-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Hire payment and commission</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The default applies to new listed-car hire payments. Each booking snapshots its
            commission when submitted; changing this setting does not alter existing bookings.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-foreground">
              Default commission (%)
              <input
                value={commissionDraft}
                onChange={(event) => setCommissionDraft(event.target.value)}
                inputMode="decimal"
                min={0}
                max={100}
                className="input-base mt-1"
              />
            </label>
            <button
              onClick={() => saveCommission.mutate()}
              disabled={
                saveCommission.isPending ||
                commissionDraft.trim() === "" ||
                Number(commissionDraft) < 0 ||
                Number(commissionDraft) > 100
              }
              className="self-end rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saveCommission.isPending ? "Saving…" : "Save commission"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-border p-3">
            <Metric label="Gross hire payments" value={totals?.grossPaidTotal ?? 0} />
            <Metric label="Platform fees" value={totals?.platformFeeTotal ?? 0} />
            <Metric label="Owner balances" value={totals?.ownerBalanceTotal ?? 0} />
          </div>
        </section>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hire or corporate requests yet.</p>
        ) : null}
        {rows.map((quote) => {
          const draft = drafts[quote.id] ?? {
            price:
              quote.quoted_total == null
                ? String(Number(quote.estimated_total))
                : String(Number(quote.quoted_total)),
            note: quote.admin_notes ?? "",
          };
          const stops = Array.isArray(quote.stops) ? (quote.stops as { label?: string }[]) : [];
          const listedCarBooking = Boolean(quote.vehicle_id && quote.payment_policy !== "legacy");
          const total = Number(quote.quoted_total ?? quote.estimated_total);
          const paid = Number(quote.payment_paid_total ?? 0);
          return (
            <section key={quote.id} className="surface-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{quote.reference}</p>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                  {listedCarBooking ? `Payment ${quote.payment_status}` : quote.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {quote.organisation ?? "Individual"} ·{" "}
                {new Date(quote.start_at).toLocaleString("en-KE")} · {quote.days} day(s) ·{" "}
                {quote.vehicle_class} ·{" "}
                {quote.drive_mode === "self_drive" ? "Self drive" : "With driver"} ·{" "}
                {quote.passengers} pax
              </p>
              {stops.length ? (
                <p className="mt-1 text-xs text-foreground">
                  {stops
                    .map((stop) => stop.label)
                    .filter(Boolean)
                    .join(" → ")}
                </p>
              ) : null}
              {quote.notes ? (
                <p className="mt-1 text-xs text-muted-foreground">{quote.notes}</p>
              ) : null}
              {listedCarBooking ? (
                <div className="mt-2 rounded-xl border border-border p-3">
                  <p className="text-sm font-semibold text-foreground">
                    Published-price hire booking
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Total KES {total.toLocaleString("en-KE")} · paid KES{" "}
                    {paid.toLocaleString("en-KE")} · balance KES{" "}
                    {Math.max(0, total - paid).toLocaleString("en-KE")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Payment policy:{" "}
                    {quote.payment_policy === "daily_flexible"
                      ? "daily installments"
                      : "full upfront"}{" "}
                    · commission snapshot: {Number(quote.commission_percent_snapshot ?? 0)}%
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Listed-car bookings are verified through M-Pesa and are not repriced or declined
                    from this quotation queue.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Estimate KES {Number(quote.estimated_total).toLocaleString("en-KE")}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input
                      value={draft.price}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [quote.id]: { ...draft, price: event.target.value },
                        })
                      }
                      inputMode="decimal"
                      placeholder="Final price (KES)"
                      className="input-base"
                    />
                    <input
                      value={draft.note}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [quote.id]: { ...draft, note: event.target.value } })
                      }
                      placeholder="Note to the customer"
                      className="input-base"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["quoted", "confirmed", "declined"] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() =>
                          decide.mutate({
                            id: quote.id,
                            status,
                            quotedTotal: status === "declined" ? null : Number(draft.price) || 0,
                            adminNotes: draft.note.trim() || undefined,
                          })
                        }
                        disabled={decide.isPending}
                        className="rounded-full border border-input px-3 py-2 text-xs font-medium text-foreground disabled:opacity-60"
                      >
                        {status === "quoted"
                          ? "Send quotation"
                          : status === "confirmed"
                            ? "Confirm"
                            : "Decline"}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          );
        })}
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">
        KES {Number(value).toLocaleString("en-KE")}
      </p>
    </div>
  );
}

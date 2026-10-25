import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PeriodSummary } from "@/components/PeriodSummary";
import { getMyHirePortfolioFinance, requestHirePayout } from "@/lib/hire.functions";
import { getBranding } from "@/lib/documents.functions";
import { buildStatementPdf, downloadPdf, type Branding } from "@/lib/pdf-docs";

const money = (value: unknown) =>
  `KES ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const localDay = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const firstOfMonth = () => localDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const dateBound = (day: string, addDay = false) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d! + (addDay ? 1 : 0)).toISOString();
};
const displayDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

export function HirePortfolioFinance() {
  const queryClient = useQueryClient();
  const financeFn = useServerFn(getMyHirePortfolioFinance);
  const requestFn = useServerFn(requestHirePayout);
  const [period, setPeriod] = useState<"day" | "week" | "month" | "custom">("month");
  const [customFrom, setCustomFrom] = useState(firstOfMonth);
  const [customTo, setCustomTo] = useState(() => localDay(new Date()));
  const range = useMemo(() => {
    const today = new Date();
    let from = localDay(today);
    let through = from;
    if (period === "week") {
      const mondayOffset = (today.getDay() + 6) % 7;
      from = localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset));
    } else if (period === "month") {
      from = firstOfMonth();
    } else if (period === "custom") {
      from = customFrom;
      through = customTo;
    }
    const valid = Boolean(from && through && from <= through);
    return {
      from: valid ? dateBound(from) : dateBound(localDay(today)),
      to: valid ? dateBound(through, true) : dateBound(localDay(today), true),
      fromDay: valid ? from : localDay(today),
      throughDay: valid ? through : localDay(today),
      valid,
    };
  }, [period, customFrom, customTo]);
  const finance = useQuery({
    queryKey: ["my-hire-portfolio-finance", range.from, range.to],
    queryFn: () => financeFn({ data: { from: range.from, to: range.to } }),
    refetchInterval: 30_000,
  });
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!phone && finance.data?.profilePhone) setPhone(finance.data.profilePhone);
  }, [finance.data?.profilePhone, phone]);

  const request = useMutation({
    mutationFn: () => requestFn({ data: { amount: Number(amount), payoutPhone: phone.trim() } }),
    onSuccess: (result) => {
      setAmount("");
      setNotice(
        `Payout request ${result.requestId.slice(0, 8)} submitted. KES ${Number(result.amount).toLocaleString("en-KE")} is reserved while Finance reviews it.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["my-hire-portfolio-finance"] });
      void queryClient.invalidateQueries({ queryKey: ["hire-provider-board"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const data = finance.data;
  const balance = data?.ownerBalance;
  const available = Number(data?.availableBalance ?? 0);
  const rangeLabel = `${displayDay(range.fromDay)} – ${displayDay(range.throughDay)}`;
  const maxVehicleNet = Math.max(0, ...(data?.vehicles.map((vehicle) =>
    data.settlements.filter((row) => row.vehicleId === vehicle.id).reduce((sum, row) => sum + row.net, 0),
  ) ?? []));

  return (
    <section className="surface-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Your car-hire earnings</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Verified hire payments are grouped by car. Hire earnings stay separate from ride-driver
          wallets.
        </p>
      </div>

      {finance.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading hire wallet…</p>
      ) : null}
      {finance.error ? (
        <p className="mt-3 text-xs text-destructive">{(finance.error as Error).message}</p>
      ) : null}
      {data ? (
        <>
          <div className="mt-3 rounded-2xl border-2 border-primary bg-primary/10 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Your money</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground">Your balance</p>
                <p className="text-lg font-extrabold text-foreground">{money(balance?.owner_balance)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Ready for you to withdraw</p>
                <p className="text-lg font-extrabold text-foreground">{money(available)}</p>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <PeriodSummary
              title="Your hire earnings by period"
              highlight="Your earnings"
              series={[
                { label: "Your earnings", rows: data.settlements.map((r) => ({ amount: r.net, at: r.at })) },
                { label: "Total paid by hirers", rows: data.settlements.map((r) => ({ amount: r.gross, at: r.at })) },
              ]}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <WalletMetric label="Total paid by hirers" value={balance?.gross_paid_total} />
            <WalletMetric label="Twende service fee" value={balance?.platform_fee_total} />
            <WalletMetric label="Already paid to you" value={balance?.paid_out_total} />
            <WalletMetric label="Your pending withdrawals" value={data.reservedPayoutTotal} />
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-semibold text-foreground">Your cars and earnings</h4>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Earnings date range">
              {([ ["day", "Day"], ["week", "Week"], ["month", "Month"], ["custom", "Custom"] ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setPeriod(key)} aria-pressed={period === key} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${period === key ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}>{label}</button>
              ))}
            </div>
            {period === "custom" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-muted-foreground">From<input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} className="input-base mt-1" /></label>
                <label className="text-[11px] text-muted-foreground">Through<input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} className="input-base mt-1" /></label>
              </div>
            ) : null}
            <p className="mt-2 text-xs font-medium text-foreground" aria-live="polite">Selected range: {rangeLabel}</p>
            {!range.valid ? <p className="mt-1 text-xs text-destructive">Choose a valid custom date range.</p> : null}
            {data.vehicles.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No hire vehicles are linked to this account yet. Add or manage listings above;
                approved cars will appear here.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {data.vehicles.map((vehicle) => (
                  <article key={vehicle.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {[vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
                            "Hire vehicle"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {vehicle.plate_number} · {vehicle.vehicle_class} ·{" "}
                          {vehicle.hire_approval_status.replaceAll("_", " ")}
                          {vehicle.hire_available ? " · listed" : " · not currently listed"}
                        </p>
                      </div>
                      <p className="text-xs font-medium text-foreground">
                        {money(vehicle.hire_daily_rate)} / day
                      </p>
                    </div>
                    {(() => {
                      const earnings = data.settlements.filter((row) => row.vehicleId === vehicle.id);
                      const gross = earnings.reduce((sum, row) => sum + row.gross, 0);
                      const net = earnings.reduce((sum, row) => sum + row.net, 0);
                      return <>
                        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2">
                          <SmallMetric label="Hirers paid" value={gross} />
                          <SmallMetric label="Payments" value={earnings.length} currency={false} />
                          <SmallMetric label="You earned" value={net} strong />
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" aria-label={`${vehicle.plate_number} earnings comparison`}>
                          <div className="h-full rounded-full bg-primary" style={{ width: `${maxVehicleNet > 0 ? (net / maxVehicleNet) * 100 : 0}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {earnings.length ? `${earnings.length} settled payment(s) in ${rangeLabel}.` : `No settled earnings for this car in ${rangeLabel}.`}
                        </p>
                      </>;
                    })()}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-border p-3">
            <h4 className="text-xs font-semibold text-foreground">Withdraw your hire earnings</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Finance reviews requests and sends approved payouts manually. A request reserves the
              amount; it does not mark money as paid.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Amount (KES; up to {money(available)})
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 5,000"
                  className="input-base mt-1"
                />
              </label>
              <label className="block text-[11px] font-medium text-muted-foreground">
                M-Pesa payout number
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  placeholder="07XX XXX XXX"
                  className="input-base mt-1"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => request.mutate()}
              disabled={
                request.isPending ||
                !amount ||
                !phone.trim() ||
                Number(amount) <= 0 ||
                Number(amount) > available
              }
              className="mt-2 w-full rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {request.isPending ? "Submitting…" : "Withdraw to my M-Pesa"}
            </button>
          </div>

          <StatementButton data={data} available={available} />
          <div className="mt-4">
            <h4 className="text-xs font-semibold text-foreground">Your withdrawal requests</h4>
            {data.payoutRequests.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No hire payout requests yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {data.payoutRequests.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-2 py-2.5"
                  >
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        {money(item.amount)} · {item.payout_phone}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Requested {new Date(item.requested_at).toLocaleString("en-KE")}
                      </p>
                      {item.review_note ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Finance: {item.review_note}
                        </p>
                      ) : null}
                      {item.payout_reference ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Receipt/reference: {item.payout_reference}
                        </p>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium capitalize text-secondary-foreground">
                      {item.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
      {notice ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function WalletMetric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-border p-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{money(value)}</p>
    </div>
  );
}

function SmallMetric({ label, value, strong, currency = true }: { label: string; value: unknown; strong?: boolean; currency?: boolean }) {
  return (
    <div className={`min-w-0 ${strong ? "rounded-lg bg-primary/10 px-1.5 py-0.5" : ""}`}>
      <p className={`text-[10px] ${strong ? "font-bold text-primary" : "text-muted-foreground"}`}>{label}</p>
      <p className={`truncate text-xs ${strong ? "font-extrabold" : "font-semibold"} text-foreground`}>{currency ? money(value) : Number(value ?? 0).toLocaleString("en-KE")}</p>
    </div>
  );
}

type FinanceData = Awaited<ReturnType<typeof getMyHirePortfolioFinance>>;
function StatementButton({ data, available }: { data: FinanceData; available: number }) {
  const brandFn = useServerFn(getBranding);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const brand = (await brandFn().catch(() => null)) as Branding | null;
      const paid = data.payoutRequests.filter((p) => p.status === "paid").reduce((a, p) => a + Number(p.amount), 0);
      const bytes = await buildStatementPdf(brand, {
        owner: "Vehicle owner",
        phone: data.profilePhone || null,
        totals: [
          ["Total hire income", money(data.ownerBalance.gross_paid_total)],
          ["Twende commission", money(data.ownerBalance.platform_fee_total)],
          ["Total requested", money(data.payoutRequests.reduce((a, p) => a + Number(p.amount), 0))],
          ["Total paid to you", money(paid)],
          ["Pending payouts", money(data.reservedPayoutTotal)],
          ["Balance available", money(available)],
        ],
        earnings: data.settlements,
        payouts: data.payoutRequests.map((p) => ({ at: p.requested_at, amount: Number(p.amount), status: p.status, ref: p.payout_reference })),
      });
      downloadPdf(bytes, `Twende-statement-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={() => void go()} disabled={busy} className="mt-3 w-full rounded-full border border-primary px-4 py-2 text-xs font-semibold text-primary disabled:opacity-60">
      {busy ? "Preparing…" : "Download statement (PDF)"}
    </button>
  );
}

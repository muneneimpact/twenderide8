import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, driverTabs } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { PeriodSummary } from "@/components/PeriodSummary";
import { getDriverWallet, requestWithdrawal, payPlatformDues } from "@/lib/driver.functions";

export const Route = createFileRoute("/_authenticated/driver/wallet")({
  head: () => ({
    meta: [
      { title: "Driver wallet & payouts — Twende Meru Rides" },
      {
        name: "description",
        content:
          "See your Twende Meru Rides earnings ledger, commission entries and request an M-PESA payout to your registered number.",
      },
      { property: "og:title", content: "Driver wallet & payouts — Twende Meru Rides" },
      { property: "og:description", content: "Earnings ledger and M-PESA payout requests for Twende Meru Rides drivers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DriverWalletPage,
});

function DriverWalletPage() {
  return (
    <RoleGate
      allow={["driver"]}
      title="Wallet"
      hint="Your earnings wallet opens once you are approved as a driver."
      actionTo="/driver/apply"
      actionLabel="Start driver onboarding"
    >
      <DriverWallet />
    </RoleGate>
  );
}

function DriverWallet() {
  const queryClient = useQueryClient();
  const fetchWallet = useServerFn(getDriverWallet);
  const withdrawFn = useServerFn(requestWithdrawal);
  const payDuesFn = useServerFn(payPlatformDues);
  const [amount, setAmount] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [duesMsisdn, setDuesMsisdn] = useState("");
  const [period, setPeriod] = useState<"today" | "week" | "month" | "custom">("month");
  const [source, setSource] = useState<"all" | "cash" | "system">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const walletQuery = useQuery({ queryKey: ["driver-wallet"], queryFn: () => fetchWallet({}) });
  const earnings = walletQuery.data?.earnings ?? null;
  const trips = walletQuery.data?.trips ?? [];
  const owedToPlatform = walletQuery.data?.owedToPlatform ?? 0;

  const customEarnings =
    customFrom && customTo
      ? trips
          .filter(
            (t) =>
              (source === "all" || t.source === source) &&
              new Date(t.completed_at).getTime() >= new Date(customFrom).getTime() &&
              new Date(t.completed_at).getTime() <= new Date(`${customTo}T23:59:59`).getTime(),
          )
          .reduce((sum, t) => sum + Number(t.net), 0)
      : 0;

  const displayEarnings =
    period === "custom" ? customEarnings : (earnings?.[period]?.[source] ?? 0);

  const withdrawing = useMutation({
    mutationFn: () => withdrawFn({ data: { amount: Number(amount), msisdn } }),
    onSuccess: () => {
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["driver-wallet"] });
      queryClient.invalidateQueries({ queryKey: ["driver-home"] });
    },
  });

  const payingDues = useMutation({
    mutationFn: () => payDuesFn({ data: { amount: owedToPlatform, msisdn: duesMsisdn } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["driver-wallet"] }),
  });

  const wallet = walletQuery.data?.wallet ?? null;
  const entries = walletQuery.data?.entries ?? [];
  const withdrawals = walletQuery.data?.withdrawals ?? [];


  return (
    <AppShell title="Wallet" tabs={driverTabs} eyebrow="Twende Driver">
      <div className="hero-gradient px-4 pb-8 pt-5">
        <div className="glass mx-auto max-w-md p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-foreground/70">
            Available balance
          </p>
          <p className="mt-1 font-display text-3xl font-semibold text-brand-foreground">
            KES {Number(wallet?.cached_balance ?? 0).toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-brand-foreground/70">
            Every entry below is immutable — corrections are posted as new entries.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <PeriodSummary
          title="Your earnings at a glance"
          highlight="Your total earnings"
          series={[
            { label: "Your total earnings", rows: trips.map((t) => ({ amount: Number(t.net), at: t.completed_at })) },
            { label: "Cash you collected", rows: trips.filter((t) => t.source === "cash").map((t) => ({ amount: Number(t.net), at: t.completed_at })) },
            { label: "Paid to you via Twende", rows: trips.filter((t) => t.source === "system").map((t) => ({ amount: Number(t.net), at: t.completed_at })) },
          ]}
        />
        {/* Earnings by period */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Your take-home</h3>
          <div className="mt-3 flex gap-1.5 overflow-x-auto">
            {(
              [
                { key: "today", label: "Today" },
                { key: "week", label: "This week" },
                { key: "month", label: "This month" },
                { key: "custom", label: "Custom" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setPeriod(tab.key)}
                className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-semibold ${
                  period === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "border border-input text-muted-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex gap-1.5">
            {(
              [
                { key: "all", label: "All" },
                { key: "cash", label: "Cash" },
                { key: "system", label: "Via system" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSource(tab.key)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  source === tab.key
                    ? "bg-secondary text-secondary-foreground"
                    : "border border-input text-muted-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {period === "custom" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">From</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">To</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl bg-secondary/50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {period === "today" ? "Earned today" : period === "week" ? "Earned this week" : period === "month" ? "Earned this month" : "Earned in range"}
            </p>
            <p className="mt-1 font-display text-2xl font-semibold text-foreground">
              KES {Number(displayEarnings).toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Your net take-home from completed trips.</p>
          </div>

          {owedToPlatform > 0 ? (
            <div className="mt-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-warning">
                Owed to platform (cash trips)
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-warning-foreground">
                KES {Number(owedToPlatform).toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-warning-foreground/80">
                Cash fares you collected. The platform commission on those trips is payable from your balance.
              </p>
              <input
                inputMode="tel"
                value={duesMsisdn}
                onChange={(event) => setDuesMsisdn(event.target.value)}
                className="mt-3 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground"
                placeholder="M-PESA number e.g. 07XX XXX XXX"
              />
              <button
                onClick={() => payingDues.mutate()}
                disabled={payingDues.isPending || !duesMsisdn}
                className="mt-2 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {payingDues.isPending ? "Sending prompt…" : `Pay now — KES ${owedToPlatform.toFixed(2)}`}
              </button>
              {payingDues.data ? (
                <p className="mt-2 text-xs text-warning-foreground/80">{payingDues.data.message}</p>
              ) : null}
              {payingDues.isError ? (
                <p className="mt-2 text-xs text-destructive">{(payingDues.error as Error).message}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Request a payout</h3>
          <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="amount">
            Amount (KES)
          </label>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground"
            placeholder="1000"
          />
          <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="msisdn">
            M-PESA number
          </label>
          <input
            id="msisdn"
            inputMode="tel"
            value={msisdn}
            onChange={(event) => setMsisdn(event.target.value)}
            className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground"
            placeholder="07XX XXX XXX"
          />
          <button
            onClick={() => withdrawing.mutate()}
            disabled={withdrawing.isPending || !amount || !msisdn}
            className="mt-4 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {withdrawing.isPending ? "Submitting…" : "Request payout"}
          </button>
          {withdrawing.isSuccess && (
            <p className="mt-2 text-xs text-muted-foreground">
              Payout requested. Finance reviews and releases payouts manually until the payout provider is live.
            </p>
          )}
          {withdrawing.isError && (
            <p className="mt-2 text-xs text-destructive">{(withdrawing.error as Error).message}</p>
          )}
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Payout requests</h3>
          {withdrawals.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No payout requests yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {withdrawals.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">KES {Number(item.amount).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString("en-KE")}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                    {item.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Ledger</h3>
          {walletQuery.isPending && <p className="mt-2 text-xs text-muted-foreground">Loading entries…</p>}
          {entries.length === 0 && !walletQuery.isPending ? (
            <p className="mt-2 text-xs text-muted-foreground">No entries yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{entry.entry_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString("en-KE")}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </div>
                  <p
                    className={`font-display text-sm font-semibold ${
                      Number(entry.amount) < 0 ? "text-destructive" : "text-success"
                    }`}
                  >
                    {Number(entry.amount) < 0 ? "" : "+"}
                    {Number(entry.amount).toFixed(2)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

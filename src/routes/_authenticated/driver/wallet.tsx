import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, driverTabs } from "@/components/AppShell";
import { getDriverWallet, requestWithdrawal } from "@/lib/driver.functions";

export const Route = createFileRoute("/_authenticated/driver/wallet")({
  head: () => ({
    meta: [
      { title: "Driver wallet & payouts — Twende Ride" },
      {
        name: "description",
        content:
          "See your Twende Ride earnings ledger, commission entries and request an M-PESA payout to your registered number.",
      },
      { property: "og:title", content: "Driver wallet & payouts — Twende Ride" },
      { property: "og:description", content: "Earnings ledger and M-PESA payout requests for Twende Ride drivers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DriverWalletPage,
});

function DriverWallet() {
  const queryClient = useQueryClient();
  const fetchWallet = useServerFn(getDriverWallet);
  const withdrawFn = useServerFn(requestWithdrawal);
  const [amount, setAmount] = useState("");
  const [msisdn, setMsisdn] = useState("");

  const walletQuery = useQuery({ queryKey: ["driver-wallet"], queryFn: () => fetchWallet({}) });

  const withdrawing = useMutation({
    mutationFn: () => withdrawFn({ data: { amount: Number(amount), msisdn } }),
    onSuccess: () => {
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["driver-wallet"] });
      queryClient.invalidateQueries({ queryKey: ["driver-home"] });
    },
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

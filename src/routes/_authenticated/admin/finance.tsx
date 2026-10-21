import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { AdminHireFinanceBoard } from "@/components/AdminHireFinanceBoard";
import { PeriodSummary } from "@/components/PeriodSummary";
import { EtrQueue } from "@/components/EtrPanels";
import { adjustWallet, getFinanceBoard, reviewWithdrawal } from "@/lib/admin.functions";
import { WalletPayoutsBoard } from "@/components/CustomerWalletCard";
import { WalletFundingBoard } from "@/components/WalletFundingBoard";

export const Route = createFileRoute("/_authenticated/admin/finance")({
  head: () => ({
    meta: [
      { title: "Finance board — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Twende Meru Rides finance: review driver and fleet wallets, approve or reject payouts, record adjustments and follow the immutable ledger.",
      },
      { property: "og:title", content: "Finance board — Twende Meru Rides" },
      { property: "og:description", content: "Wallets, payouts, refunds and the immutable ledger." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RoleGate allow={["finance_admin", "super_admin"]} title="Finance">
      <FinanceBoard />
    </RoleGate>
  ),
});

const money = (value: unknown) => `KES ${Number(value ?? 0).toFixed(2)}`;

function FinanceBoard() {
  const queryClient = useQueryClient();
  const fetchBoard = useServerFn(getFinanceBoard);
  const decideFn = useServerFn(reviewWithdrawal);
  const adjustFn = useServerFn(adjustWallet);

  const board = useQuery({ queryKey: ["finance-board"], queryFn: () => fetchBoard({}), refetchInterval: 30000 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["finance-board"] });

  const [note, setNote] = useState("");
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"bonus" | "penalty" | "manual_adjustment">("manual_adjustment");

  const decide = useMutation({
    mutationFn: (vars: { id: string; decision: "approved" | "rejected" | "paid" | "failed" }) =>
      decideFn({ data: { ...vars, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => {
      setNote("");
      invalidate();
    },
  });

  const adjust = useMutation({
    mutationFn: () =>
      adjustFn({ data: { walletId, amount: Number(amount), reason: reason.trim(), kind } }),
    onSuccess: () => {
      setAmount("");
      setReason("");
      invalidate();
    },
  });

  if (board.isPending) {
    return (
      <AppShell title="Finance" eyebrow="Twende Finance">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading the finance board…</p>
      </AppShell>
    );
  }
  if (board.error) {
    return (
      <AppShell title="Finance" eyebrow="Twende Finance">
        <p className="px-4 py-6 text-sm text-destructive">{(board.error as Error).message}</p>
      </AppShell>
    );
  }

  const b = board.data!;

  return (
    <AppShell title="Finance" eyebrow="Twende Finance">
      <div className="hero-gradient px-4 pb-8 pt-5">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
          {[
            { label: "Commission", value: money(b.totals.commission) },
            { label: "Payouts", value: money(Math.abs(b.totals.payouts)) },
            { label: "Wallets", value: String(b.wallets.length) },
            { label: "Negative", value: String(b.totals.negativeWallets) },
          ].map((stat) => (
            <section key={stat.label} className="glass p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-foreground/70">
                {stat.label}
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-brand-foreground">{stat.value}</p>
            </section>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <PeriodSummary
          title="Platform statistics"
          highlight="Platform commission earned"
          series={[
            { label: "Platform commission earned", rows: b.periodRows.commission },
            { label: "Customer payments collected", rows: b.periodRows.collected },
          ]}
        />
        <EtrQueue />
        <WalletFundingBoard />
        <WalletPayoutsBoard />
        <AdminHireFinanceBoard />

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Review note</h3>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={400}
            placeholder="Attached to the next payout decision"
            className="mt-2 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
          />
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Payout requests ({b.withdrawals.length})</h3>
          {b.withdrawals.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No payout requests yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.withdrawals.map((w) => (
                <li key={w.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">
                    {money(w.amount)} · {w.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {w.destination ?? "no destination"} · requested{" "}
                    {new Date(w.created_at).toLocaleString("en-KE")}
                    {w.review_note ? ` · ${w.review_note}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["approved", "paid", "rejected", "failed"] as const).map((decision) => (
                      <button
                        key={decision}
                        onClick={() => decide.mutate({ id: w.id, decision })}
                        disabled={decide.isPending}
                        className="rounded-full border border-input px-3.5 py-1.5 text-xs font-medium text-foreground disabled:opacity-60"
                      >
                        {decision}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {decide.isError ? (
            <p className="mt-2 text-xs text-destructive">{(decide.error as Error).message}</p>
          ) : null}
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Wallets</h3>
          <ul className="mt-2 divide-y divide-border">
            {b.wallets.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {w.owner_kind} · {money(w.cached_balance)}
                  </p>
                  <p className="text-xs text-muted-foreground">held {money(w.held_amount)}</p>
                </div>
                <button
                  onClick={() => setWalletId(w.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    walletId === w.id
                      ? "bg-primary text-primary-foreground"
                      : "border border-input text-foreground"
                  }`}
                >
                  {walletId === w.id ? "Selected" : "Select"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Record an adjustment</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Posts a new ledger entry. Existing entries are never edited or deleted.
          </p>
          <div className="mt-2 space-y-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            >
              <option value="manual_adjustment">Manual adjustment</option>
              <option value="bonus">Bonus</option>
              <option value="penalty">Penalty</option>
            </select>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Amount (negative to debit)"
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Reason (required, minimum 5 characters)"
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            />
            <button
              onClick={() => adjust.mutate()}
              disabled={!walletId || !amount || reason.trim().length < 5 || adjust.isPending}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {adjust.isPending ? "Posting…" : "Post ledger entry"}
            </button>
            {adjust.isError ? (
              <p className="text-xs text-destructive">{(adjust.error as Error).message}</p>
            ) : null}
          </div>
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Refunds ({b.refunds.length})</h3>
          {b.refunds.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No refunds recorded.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.refunds.map((r) => (
                <li key={r.id} className="py-2.5 text-sm text-foreground">
                  {money(r.amount)} · {r.status}
                  <span className="block text-xs text-muted-foreground">{r.reason ?? "no reason recorded"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Recent ledger</h3>
          <ul className="mt-2 divide-y divide-border">
            {b.entries.slice(0, 25).map((e) => (
              <li key={e.id} className="py-2 text-xs text-muted-foreground">
                <span className="text-foreground">{e.entry_type}</span> · {money(e.amount)} ·{" "}
                {new Date(e.created_at).toLocaleString("en-KE")}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

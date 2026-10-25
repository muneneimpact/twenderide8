import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { getFleetBoard, updateFleetSettlement } from "@/lib/admin.functions";
import { HireVehicleManager } from "@/components/HireVehicleManager";
import { HireRequestsBoard } from "@/components/HireRequestsBoard";
import { HirePortfolioFinance } from "@/components/HirePortfolioFinance";
import { HireAttentionSummary } from "@/components/HireAttentionSummary";
import { OwnerHireBookings } from "@/components/OwnerHireBookings";
import { HireOwnerBrandCard } from "@/components/HireOwnerPageControls";
import { VehicleTeamBoard } from "@/components/VehicleTeamBoard";

export const Route = createFileRoute("/_authenticated/fleet")({
  head: () => ({
    meta: [
      { title: "Fleet board — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Fleet owners on Twende Meru Rides: follow vehicles and drivers, set how earnings settle between fleet and driver, and read the fleet wallet ledger.",
      },
      { property: "og:title", content: "Fleet board — Twende Meru Rides" },
      { property: "og:description", content: "Vehicles, drivers, settlement rules and the fleet wallet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RoleGate allow={["fleet_owner", "ops_admin", "super_admin"]} title="Fleet">
      <FleetBoard />
    </RoleGate>
  ),
});

const money = (value: unknown) => `KES ${Number(value ?? 0).toFixed(2)}`;

function FleetBoard() {
  const queryClient = useQueryClient();
  const fetchBoard = useServerFn(getFleetBoard);
  const saveFn = useServerFn(updateFleetSettlement);
  const board = useQuery({ queryKey: ["fleet-board"], queryFn: () => fetchBoard({}) });

  const [mode, setMode] = useState<"driver_wallet" | "fleet_wallet" | "split">("fleet_wallet");
  const [split, setSplit] = useState("50");
  const [liability, setLiability] = useState<"driver" | "fleet">("driver");

  const save = useMutation({
    mutationFn: (fleetId: string) =>
      saveFn({
        data: {
          fleetId,
          settlement_mode: mode,
          driver_split_percent: Number(split) || 0,
          cash_commission_liability: liability,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fleet-board"] }),
  });

  if (board.isPending) {
    return (
      <AppShell title="Fleet" eyebrow="Twende Fleet">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading your fleet…</p>
      </AppShell>
    );
  }
  if (board.error) {
    return (
      <AppShell title="Fleet" eyebrow="Twende Fleet">
        <p className="px-4 py-6 text-sm text-destructive">{(board.error as Error).message}</p>
      </AppShell>
    );
  }

  const b = board.data!;
  if (b.fleets.length === 0) {
    return (
      <AppShell title="Fleet" eyebrow="Twende Fleet">
        <div className="mx-auto max-w-md px-4 py-6">
          <section className="surface-card p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">No fleet yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Fleets are created by operations once your business details and documents have been checked. Ask
              the Twende Meru Rides team to register your business, then this board will show your vehicles, drivers
              and wallet.
            </p>
          </section>
        </div>
      </AppShell>
    );
  }

  const fleet = b.fleets[0]!;

  return (
    <AppShell title="Fleet" eyebrow="Twende Fleet">
      <div className="hero-gradient px-4 pb-8 pt-5">
        <div className="mx-auto max-w-md">
          <section className="glass p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-foreground/70">
              {fleet.status}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-brand-foreground">
              {fleet.business_name}
            </h2>
            <p className="mt-2 text-sm text-brand-foreground/80">
              Wallet {money(b.wallet?.cached_balance)} · held {money(b.wallet?.held_amount)}
            </p>
          </section>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Settlement rules</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Currently {fleet.settlement_mode} · driver share {Number(fleet.driver_split_percent)}% · cash
            commission owed by {fleet.cash_commission_liability}.
          </p>
          <div className="mt-3 space-y-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            >
              <option value="fleet_wallet">Earnings to the fleet wallet</option>
              <option value="driver_wallet">Earnings to the driver wallet</option>
              <option value="split">Split between fleet and driver</option>
            </select>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Driver share %</span>
              <input
                value={split}
                onChange={(e) => setSplit(e.target.value)}
                inputMode="decimal"
                className="mt-0.5 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
              />
            </label>
            <select
              value={liability}
              onChange={(e) => setLiability(e.target.value as typeof liability)}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            >
              <option value="driver">Driver owes cash commission</option>
              <option value="fleet">Fleet owes cash commission</option>
            </select>
            <button
              onClick={() => save.mutate(fleet.id)}
              disabled={save.isPending}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save settlement rules"}
            </button>
            {save.isError ? (
              <p className="text-xs text-destructive">{(save.error as Error).message}</p>
            ) : null}
          </div>
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Vehicles ({b.vehicles.length})</h3>
          <ul className="mt-2 divide-y divide-border">
            {b.vehicles.map((vehicle) => (
              <li key={vehicle.id} className="py-2.5">
                <p className="text-sm font-medium text-foreground">
                  {vehicle.plate_number} · {vehicle.vehicle_class}
                </p>
                <p className="text-xs text-muted-foreground">
                  {vehicle.status}
                  {vehicle.active_driver_id
                    ? ` · driving now: ${
                        b.drivers.find((d) => d.id === vehicle.active_driver_id)?.full_name ?? "driver"
                      }`
                    : " · idle"}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Recent fleet rides</h3>
          {b.rides.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No rides yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.rides.map((ride) => (
                <li key={ride.id} className="py-2.5 text-sm text-foreground">
                  {ride.reference} · {money(ride.total_fare)}
                  <span className="block text-xs text-muted-foreground">
                    {ride.status} · {ride.payment_method} · {ride.payment_status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Fleet ledger</h3>
          <ul className="mt-2 divide-y divide-border">
            {b.entries.map((entry) => (
              <li key={entry.id} className="py-2 text-xs text-muted-foreground">
                <span className="text-foreground">{entry.entry_type}</span> · {money(entry.amount)} ·{" "}
                {new Date(entry.created_at).toLocaleString("en-KE")}
              </li>
            ))}
          </ul>
        </section>

        <VehicleTeamBoard />
        <HireAttentionSummary />
        <HireOwnerBrandCard />
        <HireVehicleManager />
        <OwnerHireBookings />
        <HireRequestsBoard />
        <HirePortfolioFinance />
      </div>
    </AppShell>
  );
}

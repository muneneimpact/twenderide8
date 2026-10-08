import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getMyHirePortfolioFinance, requestHirePayout } from "@/lib/hire.functions";

const money = (value: unknown) =>
  `KES ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function HirePortfolioFinance() {
  const queryClient = useQueryClient();
  const financeFn = useServerFn(getMyHirePortfolioFinance);
  const requestFn = useServerFn(requestHirePayout);
  const finance = useQuery({
    queryKey: ["my-hire-portfolio-finance"],
    queryFn: () => financeFn(),
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

  return (
    <section className="surface-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Hire portfolio & wallet</h3>
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
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <WalletMetric label="Hire gross paid" value={balance?.gross_paid_total} />
            <WalletMetric label="Platform commission" value={balance?.platform_fee_total} />
            <WalletMetric label="Owner balance" value={balance?.owner_balance} />
            <WalletMetric label="Paid out" value={balance?.paid_out_total} />
            <WalletMetric label="Reserved requests" value={data.reservedPayoutTotal} />
            <WalletMetric label="Available to request" value={available} />
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-semibold text-foreground">My hire listings and earnings</h4>
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
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2">
                      <SmallMetric label="Gross" value={vehicle.finance.gross_paid_total} />
                      <SmallMetric label="System gets" value={vehicle.finance.platform_fee_total} />
                      <SmallMetric label="Owner gets" value={vehicle.finance.owner_net_total} />
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {vehicle.finance.settlement_count} settled payment(s). Account wallet and
                      payouts are shared across cars owned by this account.
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-border p-3">
            <h4 className="text-xs font-semibold text-foreground">Request hire funds</h4>
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
              {request.isPending ? "Submitting…" : "Request payout from hire wallet"}
            </button>
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-semibold text-foreground">My hire payout requests</h4>
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

function SmallMetric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-semibold text-foreground">{money(value)}</p>
    </div>
  );
}

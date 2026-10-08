import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getAdminHirePortfolioFinance, reviewHirePayoutRequest } from "@/lib/hire.functions";

const money = (value: unknown) =>
  `KES ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ReviewDraft = { note: string; payoutReference: string };

export function AdminHireFinanceBoard() {
  const queryClient = useQueryClient();
  const financeFn = useServerFn(getAdminHirePortfolioFinance);
  const reviewFn = useServerFn(reviewHirePayoutRequest);
  const finance = useQuery({
    queryKey: ["admin-hire-portfolio-finance"],
    queryFn: () => financeFn(),
    refetchInterval: 30_000,
  });
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: (input: {
      id: string;
      decision: "approved" | "paid" | "rejected";
      note?: string;
      payoutReference?: string;
    }) => reviewFn({ data: input }),
    onSuccess: (_result, input) => {
      setNotice(`Hire payout request ${input.id.slice(0, 8)} marked ${input.decision}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin-hire-portfolio-finance"] });
      void queryClient.invalidateQueries({ queryKey: ["my-hire-portfolio-finance"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const data = finance.data;
  return (
    <section className="surface-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Hire cars, wallets & payouts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Approved hire cars show verified settled amounts only. Owner wallet balances are
          account-level and shared across that account’s cars.
        </p>
      </div>
      {finance.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading hire finance…</p>
      ) : null}
      {finance.error ? (
        <p className="mt-3 text-xs text-destructive">{(finance.error as Error).message}</p>
      ) : null}
      {data ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Hire gross paid" value={data.totals.grossPaidTotal} />
            <Metric label="System commission" value={data.totals.platformFeeTotal} />
            <Metric label="Owner wallets" value={data.totals.ownerWalletTotal} />
            <Metric label="Paid out" value={data.totals.paidOutTotal} />
            <Metric label="Reserved payouts" value={data.totals.reservedPayoutTotal} />
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-semibold text-foreground">
              Approved hire vehicles ({data.vehicles.length})
            </h3>
            {data.vehicles.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No hire vehicles have completed approval yet.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {data.vehicles.map((vehicle) => (
                  <article key={vehicle.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {[vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
                            "Hire vehicle"}{" "}
                          · {vehicle.plate_number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {vehicle.vehicle_class} ·{" "}
                          {vehicle.hire_available ? "listed" : "approved, not listed"} · owner{" "}
                          {vehicle.owner_name}
                          {vehicle.owner_phone ? ` · ${vehicle.owner_phone}` : ""}
                        </p>
                      </div>
                      <p className="text-xs font-medium text-foreground">
                        {money(vehicle.hire_daily_rate)} / day
                      </p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2 sm:grid-cols-3">
                      <Metric label="This car · gross" value={vehicle.finance.gross_paid_total} />
                      <Metric
                        label="System commission"
                        value={vehicle.finance.platform_fee_total}
                      />
                      <Metric
                        label="This car · owner net"
                        value={vehicle.finance.owner_net_total}
                      />
                    </div>
                    <div className="mt-2 rounded-lg bg-secondary/50 p-2">
                      <p className="text-[10px] font-semibold text-foreground">
                        Account holder’s hire wallet
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Balance {money(vehicle.owner_wallet_balance)} · paid out{" "}
                        {money(vehicle.owner_paid_out_total)} · reserved{" "}
                        {money(vehicle.owner_reserved_payout_total)} · available{" "}
                        {money(vehicle.owner_available_balance)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {vehicle.finance.settlement_count} settled payment(s) attributed to this
                        car. Wallet is shared across the account’s cars.
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5">
            <h3 className="text-xs font-semibold text-foreground">
              Hire fund requests ({data.payoutRequests.length})
            </h3>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Finance makes the M-Pesa transfer outside the app, then records the receipt before
              marking a request paid.
            </p>
            {data.payoutRequests.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No hire fund requests yet.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {data.payoutRequests.map((item) => {
                  const draft = drafts[item.id] ?? { note: "", payoutReference: "" };
                  const open = item.status === "requested" || item.status === "approved";
                  return (
                    <article key={item.id} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {money(item.amount)} · {item.owner_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.payout_phone} · requested{" "}
                            {new Date(item.requested_at).toLocaleString("en-KE")}
                          </p>
                          {item.owner_phone ? (
                            <p className="text-[10px] text-muted-foreground">
                              Account phone: {item.owner_phone}
                            </p>
                          ) : null}
                          {item.review_note ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Finance note: {item.review_note}
                            </p>
                          ) : null}
                          {item.payout_reference ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Payout receipt/reference: {item.payout_reference}
                            </p>
                          ) : null}
                        </div>
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium capitalize text-secondary-foreground">
                          {item.status}
                        </span>
                      </div>
                      {open && data.canReviewPayouts ? (
                        <div className="mt-2 space-y-2">
                          <input
                            value={draft.note}
                            onChange={(event) =>
                              setDrafts({
                                ...drafts,
                                [item.id]: { ...draft, note: event.target.value },
                              })
                            }
                            maxLength={400}
                            placeholder="Optional review note"
                            className="input-base"
                          />
                          {item.status === "approved" ? (
                            <input
                              value={draft.payoutReference}
                              onChange={(event) =>
                                setDrafts({
                                  ...drafts,
                                  [item.id]: { ...draft, payoutReference: event.target.value },
                                })
                              }
                              maxLength={120}
                              placeholder="M-Pesa receipt/reference (required to mark paid)"
                              className="input-base"
                            />
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {item.status === "requested" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    review.mutate({
                                      id: item.id,
                                      decision: "approved",
                                      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
                                    })
                                  }
                                  disabled={review.isPending}
                                  className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                                >
                                  Approve request
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    review.mutate({
                                      id: item.id,
                                      decision: "rejected",
                                      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
                                    })
                                  }
                                  disabled={review.isPending || !draft.note.trim()}
                                  className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-60"
                                >
                                  Reject with note
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    review.mutate({
                                      id: item.id,
                                      decision: "paid",
                                      payoutReference: draft.payoutReference.trim(),
                                      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
                                    })
                                  }
                                  disabled={review.isPending || !draft.payoutReference.trim()}
                                  className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                                >
                                  Mark paid
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    review.mutate({
                                      id: item.id,
                                      decision: "rejected",
                                      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
                                    })
                                  }
                                  disabled={review.isPending || !draft.note.trim()}
                                  className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-60"
                                >
                                  Reject with note
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
      {review.isError ? (
        <p className="mt-2 text-xs text-destructive">{(review.error as Error).message}</p>
      ) : null}
      {notice ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{money(value)}</p>
    </div>
  );
}

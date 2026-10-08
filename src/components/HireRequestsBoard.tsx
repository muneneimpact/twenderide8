import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listHireRequestsForProvider,
  makeHireOffer,
  requestHirePaymentReminder,
} from "@/lib/hire.functions";

/** Paid hire bookings and quote-first requests the driver/owner can actually serve. */
export function HireRequestsBoard() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listHireRequestsForProvider);
  const offerFn = useServerFn(makeHireOffer);
  const reminderFn = useServerFn(requestHirePaymentReminder);
  const board = useQuery({
    queryKey: ["hire-provider-board"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
  });
  const [drafts, setDrafts] = useState<
    Record<string, { vehicleId: string; price: string; note: string }>
  >({});
  const [reminderAmounts, setReminderAmounts] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<Array<"sms" | "email" | "whatsapp">>([
    "sms",
    "email",
    "whatsapp",
  ]);
  const [notice, setNotice] = useState<string | null>(null);

  const offer = useMutation({
    mutationFn: (vars: { quoteId: string; vehicleId: string; price: number; note?: string }) =>
      offerFn({ data: vars }),
    onSuccess: () => {
      setNotice("Offer sent to the customer.");
      queryClient.invalidateQueries({ queryKey: ["hire-provider-board"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const reminder = useMutation({
    mutationFn: (vars: {
      quoteId: string;
      amount: number;
      channels: Array<"sms" | "email" | "whatsapp">;
    }) => reminderFn({ data: vars }),
    onSuccess: (result) => {
      const statuses = Object.entries(result.channels ?? {})
        .map(([channel, status]) => `${channel}: ${status.replaceAll("_", " ")}`)
        .join(" · ");
      setNotice(
        result.accepted
          ? `M-Pesa prompt started. ${statuses || "The customer can approve payment on their phone."}`
          : result.message,
      );
      queryClient.invalidateQueries({ queryKey: ["hire-provider-board"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const vehicles = board.data?.vehicles ?? [];
  const requests = board.data?.requests ?? [];
  const balance = board.data?.owner_balance;
  const setChannel = (channel: "sms" | "email" | "whatsapp", on: boolean) => {
    setChannels((current) =>
      on ? [...new Set([...current, channel])] : current.filter((item) => item !== channel),
    );
  };

  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Hire bookings and requests</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Listed-car requests appear here only after the required payment clears. Unpaid requests
        remain private to the customer.
      </p>

      {balance ? (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-border p-3">
          <Balance label="Owner balance" value={balance.owner_balance} />
          <Balance label="Platform fee total" value={balance.platform_fee_total} />
          <Balance label="Gross paid" value={balance.gross_paid_total} />
        </div>
      ) : null}

      {board.isPending ? <p className="mt-3 text-xs text-muted-foreground">Loading…</p> : null}
      {!board.isPending && requests.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No paid hire bookings or matching quote requests yet.
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {requests.map((request) => {
          const stops = Array.isArray(request.stops) ? (request.stops as { label?: string }[]) : [];
          const fixedPriceBooking = Boolean(
            request.vehicle_id && request.payment_policy !== "legacy",
          );
          const draft = drafts[request.id] ?? {
            vehicleId: vehicles[0]?.id ?? "",
            price: String(Number(request.estimated_total) || 0),
            note: "",
          };
          const total = Number(request.quoted_total ?? request.estimated_total);
          const paid = Number(request.payment_paid_total ?? 0);
          const remaining = Math.max(0, total - paid);
          const installment = Math.min(
            remaining,
            Number(request.payment_minimum_amount ?? Math.ceil(total / Math.max(1, request.days))),
          );
          const perBooking = request.settlement_totals;
          const plate = vehicles.find((vehicle) => vehicle.id === request.vehicle_id)?.plate_number;
          return (
            <article key={request.id} className="rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{request.reference}</p>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                  {fixedPriceBooking
                    ? `Payment ${request.payment_status}`
                    : request.drive_mode === "self_drive"
                      ? "Self drive"
                      : "With driver"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(request.start_at).toLocaleString("en-KE")} · {request.days} day(s) ·{" "}
                {request.vehicle_class} · {request.passengers} pax
              </p>
              {request.end_at ? (
                <p className="text-xs text-muted-foreground">
                  Return: {new Date(request.end_at).toLocaleString("en-KE")}
                </p>
              ) : null}
              {plate ? <p className="mt-1 text-xs text-foreground">Vehicle: {plate}</p> : null}
              {request.renter_name ? (
                <p className="mt-1 text-xs text-foreground">Hirer: {request.renter_name}</p>
              ) : null}
              {request.pickup_label ? (
                <p className="mt-1 text-xs text-foreground">Collect from: {request.pickup_label}</p>
              ) : null}
              {stops.length ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {stops
                    .map((stop) => stop.label)
                    .filter(Boolean)
                    .join(" → ")}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {fixedPriceBooking
                  ? `Listed total KES ${total.toLocaleString("en-KE")}`
                  : `Customer estimate KES ${Number(request.estimated_total).toLocaleString("en-KE")}`}
              </p>
              {request.id_document_link ? (
                <a
                  href={request.id_document_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 mr-3 inline-block text-xs font-medium text-primary"
                >
                  View hirer ID
                </a>
              ) : null}
              {request.license_document_link ? (
                <a
                  href={request.license_document_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs font-medium text-primary"
                >
                  View driving licence
                </a>
              ) : null}

              {fixedPriceBooking ? (
                <div className="mt-3 rounded-xl bg-secondary/50 p-3">
                  <p className="text-xs font-semibold text-foreground">Payment and commission</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Paid KES {paid.toLocaleString("en-KE")} · outstanding KES{" "}
                    {remaining.toLocaleString("en-KE")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Gross collected KES {Number(perBooking.gross).toLocaleString("en-KE")} ·
                    platform fee KES {Number(perBooking.fee).toLocaleString("en-KE")} · owner net
                    KES {Number(perBooking.net).toLocaleString("en-KE")}
                  </p>
                  {request.payment_status === "partial" && remaining > 0 ? (
                    <div className="mt-3 space-y-2">
                      <label className="block text-xs font-medium text-foreground">
                        Request payment (KES)
                        <input
                          value={reminderAmounts[request.id] ?? String(installment)}
                          inputMode="numeric"
                          onChange={(event) =>
                            setReminderAmounts({
                              ...reminderAmounts,
                              [request.id]: event.target.value,
                            })
                          }
                          className="input-base mt-1"
                        />
                      </label>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                        {(["sms", "email", "whatsapp"] as const).map((channel) => (
                          <label
                            key={channel}
                            className="inline-flex items-center gap-1.5 capitalize"
                          >
                            <input
                              type="checkbox"
                              checked={channels.includes(channel)}
                              onChange={(event) => setChannel(channel, event.target.checked)}
                            />
                            {channel}
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={() =>
                          reminder.mutate({
                            quoteId: request.id,
                            amount: Number(reminderAmounts[request.id] ?? installment),
                            channels,
                          })
                        }
                        disabled={
                          reminder.isPending ||
                          channels.length === 0 ||
                          Number(reminderAmounts[request.id] ?? installment) <= 0 ||
                          Number(reminderAmounts[request.id] ?? installment) > remaining
                        }
                        className="w-full rounded-full bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {reminder.isPending
                          ? "Starting payment…"
                          : "Request M-Pesa payment and send reminder"}
                      </button>
                      <p className="text-[10px] text-muted-foreground">
                        SMS/email use the customer’s channel preferences. WhatsApp sends only with
                        explicit opt-in and an approved template; otherwise it is skipped.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  {request.my_offer ? (
                    <p className="mt-2 text-xs font-medium text-foreground">
                      Your offer: KES {Number(request.my_offer.price).toLocaleString("en-KE")} (
                      {request.my_offer.status})
                    </p>
                  ) : null}
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <select
                      value={draft.vehicleId}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [request.id]: { ...draft, vehicleId: event.target.value },
                        })
                      }
                      className="input-base"
                    >
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.plate_number} · {vehicle.vehicle_class}
                        </option>
                      ))}
                    </select>
                    <input
                      value={draft.price}
                      inputMode="decimal"
                      placeholder="Your price (KES)"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [request.id]: { ...draft, price: event.target.value },
                        })
                      }
                      className="input-base"
                    />
                    <input
                      value={draft.note}
                      placeholder="Note to the customer"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [request.id]: { ...draft, note: event.target.value },
                        })
                      }
                      className="input-base"
                    />
                  </div>
                  <button
                    onClick={() =>
                      offer.mutate({
                        quoteId: request.id,
                        vehicleId: draft.vehicleId,
                        price: Number(draft.price) || 0,
                        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
                      })
                    }
                    disabled={offer.isPending || !draft.vehicleId}
                    className="mt-2 w-full rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {offer.isPending
                      ? "Sending…"
                      : request.my_offer
                        ? "Update my offer"
                        : "Send offer"}
                  </button>
                </>
              )}
            </article>
          );
        })}
      </div>
      {notice ? <p className="mt-2 text-xs text-muted-foreground">{notice}</p> : null}
    </section>
  );
}

function Balance({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">
        KES {Number(value).toLocaleString("en-KE")}
      </p>
    </div>
  );
}

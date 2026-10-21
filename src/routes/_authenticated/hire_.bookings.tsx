import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CompanyBookingsDashboard } from "@/components/CompanyBookingsDashboard";
import { HirerVehicleDetails } from "@/components/HirerVehicleDetails";
import { PayHireWithWallet } from "@/components/CustomerWalletCard";
import { PaymentProgressCard, type PayState } from "@/components/PaymentProgressCard";
import { ReceiptDownload } from "@/components/ReceiptDownload";
import { supabase } from "@/integrations/supabase/client";
import {
  checkHirePaymentNow,
  listMyHireQuotes,
  payHireBooking,
  respondToHireOffer,
} from "@/lib/hire.functions";

export const Route = createFileRoute("/_authenticated/hire_/bookings")({
  head: () => ({
    meta: [
      { title: "Your car hire bookings | Twende Meru Rides" },
      {
        name: "description",
        content:
          "Track your car hire requests and company bookings: pay instalments, sign agreements, add odometer and fuel details, and download receipts and ETRs.",
      },
      { property: "og:title", content: "Your car hire bookings | Twende Meru Rides" },
      {
        property: "og:description",
        content: "Every hire request, payment, agreement and receipt in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HireBookingsPage,
});

const STATUS_COPY: Record<string, string> = {
  submitted: "Waiting for offers",
  quoted: "Offer waiting for you",
  confirmed: "Confirmed",
  declined: "Not available",
};

const DAY = 86_400_000;

function HireBookingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listMyHireQuotes);
  const respondFn = useServerFn(respondToHireOffer);
  const payFn = useServerFn(payHireBooking);
  const checkPaymentFn = useServerFn(checkHirePaymentNow);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [payCard, setPayCard] = useState<{ quoteId: string; amount?: number | null } | null>(null);
  const [paymentPhone, setPaymentPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const quotes = useQuery({
    queryKey: ["hire-quotes"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile?.phone) setPaymentPhone(profile.phone);
    });
  }, []);

  const respond = useMutation({
    mutationFn: (vars: { offerId: string; action: "accept" | "decline" }) =>
      respondFn({ data: vars }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hire-quotes"] }),
  });

  const pay = useMutation({
    mutationFn: (vars: { quoteId: string; amount?: number }) =>
      payFn({ data: { ...vars, phone: paymentPhone.trim() || undefined } }),
    onSuccess: (result, vars) => {
      if (result.accepted) setPayCard({ quoteId: vars.quoteId, amount: vars.amount ?? null });
      setMessage(
        result.accepted
          ? "M-Pesa prompt sent. Approve it on your phone; the booking updates after payment clears."
          : result.message,
      );
      void queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
      void queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  return (
    <AppShell title="Your hire bookings">
      <div className="space-y-4 pb-24">
        <div className="flex gap-2">
          <Link
            to="/hire"
            className="flex-1 rounded-full border border-input px-3 py-2 text-center text-xs font-semibold text-foreground"
          >
            Browse cars
          </Link>
          <Link
            to="/hire/company"
            className="flex-1 rounded-full border border-input px-3 py-2 text-center text-xs font-semibold text-foreground"
          >
            Company account
          </Link>
        </div>

        {message ? <p className="mx-4 text-xs text-muted-foreground">{message}</p> : null}

        <CompanyBookingsDashboard quotes={(quotes.data ?? []) as never} />

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Your requests</h3>
          {(quotes.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No requests yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {(quotes.data ?? []).map((q) => (
                <li key={q.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{q.reference}</p>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                      {q.pay_later_method && q.status === "submitted"
                        ? "Waiting for owner verification"
                        : (STATUS_COPY[q.status] ?? q.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(q.start_at).toLocaleString("en-KE")} –{" "}
                    {new Date(
                      q.end_at ?? new Date(new Date(q.start_at).getTime() + q.days * DAY),
                    ).toLocaleString("en-KE")}{" "}
                    · {q.days} day(s) · {q.passengers} people ·{" "}
                    {q.drive_mode === "self_drive" ? "Self drive" : "With driver"}
                  </p>
                  <p className="mt-1 font-display text-sm font-semibold text-foreground">
                    {q.quoted_total == null
                      ? `Estimate KES ${Number(q.estimated_total).toLocaleString("en-KE")}`
                      : `KES ${Number(q.quoted_total).toLocaleString("en-KE")}`}
                  </p>
                  {q.admin_notes ? (
                    <p className="mt-1 text-xs text-muted-foreground">{q.admin_notes}</p>
                  ) : null}
                  {q.vehicle_id &&
                  (q.payment_status === "paid" ||
                    q.payment_status === "partially_paid" ||
                    Number(q.payment_paid_total ?? 0) > 0 ||
                    !!q.pay_later_method) ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        to="/hire/agreement/$quoteId"
                        params={{ quoteId: q.id }}
                        hash="sign"
                        className="inline-block rounded-full border border-primary px-3 py-1.5 text-xs font-semibold text-primary"
                      >
                        Sign & download agreement
                      </Link>
                      {Number(q.payment_paid_total ?? 0) > 0 ? (
                        <ReceiptDownload
                          kind="hire"
                          id={q.id}
                          label="Receipt (PDF)"
                          className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
                        />
                      ) : null}
                      <button
                        onClick={() => setDetailsId(detailsId === q.id ? null : q.id)}
                        className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground"
                      >
                        {detailsId === q.id ? "Close car details" : "Add car details (odometer, fuel)"}
                      </button>
                    </div>
                  ) : null}
                  {detailsId === q.id ? (
                    <HirerVehicleDetails
                      quoteId={q.id}
                      saved={(q.hirer_inspection ?? null) as never}
                      ownerOdometer={q.inspection_odometer ?? null}
                      ownerFuel={(q as { inspection_fuel?: string | null }).inspection_fuel ?? null}
                    />
                  ) : null}
                  {q.vehicle_id && q.payment_policy !== "legacy"
                    ? (() => {
                        const total = Number(q.quoted_total ?? q.estimated_total);
                        const paid = Number(q.payment_paid_total ?? 0);
                        const remaining = Math.max(0, total - paid);
                        const installment = Math.min(
                          remaining,
                          Number(
                            q.payment_minimum_amount ?? Math.ceil(total / Math.max(1, q.days)),
                          ),
                        );
                        return (
                          <div className="mt-2 rounded-xl border border-border p-3">
                            <p className="text-xs font-semibold text-foreground">
                              Payment: {String(q.payment_status).replaceAll("_", " ")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Paid KES {paid.toLocaleString("en-KE")} of KES{" "}
                              {total.toLocaleString("en-KE")} · balance KES{" "}
                              {remaining.toLocaleString("en-KE")}
                            </p>
                            {q.payment_status === "pending" ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Approve the pending M-Pesa prompt. The owner sees your booking after
                                the required payment clears.
                              </p>
                            ) : null}
                            {remaining > 0 &&
                            q.payment_status !== "pending" &&
                            q.status !== "declined" ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  onClick={() =>
                                    pay.mutate({
                                      quoteId: q.id,
                                      amount: q.payment_policy === "full" ? remaining : installment,
                                    })
                                  }
                                  disabled={pay.isPending}
                                  className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                                >
                                  {pay.isPending
                                    ? "Starting…"
                                    : q.payment_status === "failed" ||
                                        q.payment_status === "timed_out"
                                      ? `Retry KES ${installment.toLocaleString("en-KE")}`
                                      : `Pay next installment KES ${installment.toLocaleString("en-KE")}`}
                                </button>
                                <PayHireWithWallet
                                  quoteId={q.id}
                                  amount={q.payment_policy === "full" ? remaining : installment}
                                />
                                {q.payment_policy === "daily_flexible" &&
                                remaining > installment ? (
                                  <button
                                    onClick={() => pay.mutate({ quoteId: q.id, amount: remaining })}
                                    disabled={pay.isPending}
                                    className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-60"
                                  >
                                    Pay full balance KES {remaining.toLocaleString("en-KE")}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()
                    : null}
                  {(q.offers ?? [])
                    .filter((o) => o.status === "offered")
                    .map((o) => (
                      <div key={o.id} className="mt-2 rounded-xl border border-border p-2.5">
                        <p className="text-sm font-semibold text-foreground">
                          Offer: KES {Number(o.price).toLocaleString("en-KE")}
                        </p>
                        {o.note ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">{o.note}</p>
                        ) : null}
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => respond.mutate({ offerId: o.id, action: "accept" })}
                            disabled={respond.isPending}
                            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => respond.mutate({ offerId: o.id, action: "decline" })}
                            disabled={respond.isPending}
                            className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-60"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <PaymentProgressCard
        open={!!payCard}
        amount={payCard?.amount}
        phone={paymentPhone || null}
        check={async (): Promise<PayState> => {
          if (!payCard) return "pending";
          return checkPaymentFn({ data: { quoteId: payCard.quoteId } });
        }}
        onSuccess={() => {
          const id = payCard?.quoteId;
          setPayCard(null);
          void queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
          if (id) void navigate({ to: "/hire/agreement/$quoteId", params: { quoteId: id }, hash: "sign" });
        }}
        onRetry={() => {
          if (payCard) pay.mutate({ quoteId: payCard.quoteId });
        }}
        onClose={() => setPayCard(null)}
        successLabel="Sign your agreement"
      />
    </AppShell>
  );
}

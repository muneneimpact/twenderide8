import { PayRideWithWallet } from "@/components/CustomerWalletCard";
import { RateTrip, TripComplaint } from "@/components/RideFeedback";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { getRideCreditState, keepRideAsCredit, retryRideWithCredit } from "@/lib/wallet.functions";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PaymentProgressCard, type PayState } from "@/components/PaymentProgressCard";
import { MapPanel } from "@/components/MapPanel";
import { supabase } from "@/integrations/supabase/client";
import { cancelRide, getRide, rateRide, requestUnfulfilledRefund } from "@/lib/rides.functions";
import { getPaymentStatus, startStkPush } from "@/lib/payments.functions";
import { playAlert } from "@/lib/audio";
import { CarBadge } from "@/components/CarBadge";
import { RideChat } from "@/components/RideChat";
import { ReceiptActions } from "@/components/ReceiptActions";
import { RideEtrRequest } from "@/components/EtrPanels";

const cancelReasons = [
  "Driver is taking too long",
  "I booked by mistake",
  "My plans changed",
  "I found another ride",
  "Wrong pickup location",
  "Other",
];

export const Route = createFileRoute("/_authenticated/rides/$rideId")({
  head: () => ({
    meta: [
      { title: "Track your taxi — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Watch your Twende Meru Rides driver approach in real time, see the locked fare, pay by M-PESA or cancel.",
      },
      { property: "og:title", content: "Track your taxi — Twende Meru Rides" },
      {
        property: "og:description",
        content: "Live driver approach tracking and payment for your Meru taxi.",
      },
    ],
  }),
  component: RideDetail,
});

const statusCopy: Record<string, { title: string; body: string }> = {
  searching: { title: "Finding a driver", body: "We are offering your ride to nearby drivers." },
  driver_assigned: {
    title: "Driver on the way",
    body: "Your driver is approaching the pickup pin.",
  },
  driver_arrived: {
    title: "Driver has arrived",
    body: "Your driver is waiting at the pickup pin.",
  },
  trip_started: { title: "On trip", body: "Enjoy the ride — the fare is already locked." },
  trip_completed: { title: "Trip completed", body: "Thanks for riding with Twende." },
  cancelled_by_customer: { title: "Cancelled", body: "You cancelled this ride." },
  cancelled_by_driver: {
    title: "Cancelled by driver",
    body: "The driver cancelled. No fare is due.",
  },
  cancelled_by_ops: { title: "Cancelled by operations", body: "Operations cancelled this ride." },
  no_driver_found: {
    title: "No driver found",
    body: "No driver was available nearby. Nothing was charged.",
  },
};

function RideDetail() {
  const { rideId } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchRide = useServerFn(getRide);
  const fetchPayment = useServerFn(getPaymentStatus);
  const cancelFn = useServerFn(cancelRide);
  const pushFn = useServerFn(startStkPush);
  const rateFn = useServerFn(rateRide);
  const [score, setScore] = useState(5);
  const [reasonCode, setReasonCode] = useState(cancelReasons[0]!);
  const [reasonNote, setReasonNote] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  const rideQuery = useQuery({
    queryKey: ["ride", rideId],
    queryFn: () => fetchRide({ data: { rideId } }),
    refetchInterval: 15000,
  });

  // Waiting on an M-Pesa prompt is checked every 3 seconds for a minute and a
  // half, then it falls back to the slow poll so nobody is left spinning.
  const waitingSince = useRef<number | null>(null);
  const paymentQuery = useQuery({
    queryKey: ["ride-payment", rideId],
    queryFn: () => fetchPayment({ data: { rideId } }),
    refetchInterval: (query) => {
      const status = query.state.data?.ride?.payment_status;
      const waiting =
        status !== undefined &&
        ["pending", "initiating", "awaiting_confirmation", "processing"].includes(status);
      if (!waiting) {
        waitingSince.current = null;
        return 20000;
      }
      waitingSince.current ??= Date.now();
      return Date.now() - waitingSince.current < 90000 ? 3000 : 20000;
    },
  });

  // Realtime keeps the status and driver position fresh between polls.
  useEffect(() => {
    const channel = supabase
      .channel(`ride:${rideId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides", filter: `id=eq.${rideId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["ride", rideId] });
          queryClient.invalidateQueries({ queryKey: ["ride-payment", rideId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ride_locations",
          filter: `ride_id=eq.${rideId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["ride", rideId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, rideId]);

  const refundFn = useServerFn(requestUnfulfilledRefund);
  const refunding = useMutation({
    mutationFn: () => refundFn({ data: { rideId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ride", rideId] });
      queryClient.invalidateQueries({ queryKey: ["ride-payment", rideId] });
    },
  });
  const navigate = useNavigate();
  const creditStateFn = useServerFn(getRideCreditState);
  const retryFn = useServerFn(retryRideWithCredit);
  const keepFn = useServerFn(keepRideAsCredit);
  const creditState = useQuery({
    queryKey: ["ride-credit", rideId],
    queryFn: () => creditStateFn({ data: { rideId } }),
  });
  const retrying = useMutation({
    mutationFn: () => retryFn({ data: { rideId } }),
    onSuccess: (r) => navigate({ to: "/rides/$rideId", params: { rideId: r.rideId } }),
  });
  const keeping = useMutation({
    mutationFn: () => keepFn({ data: { rideId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ride-credit", rideId] }),
  });

  const cancelling = useMutation({
    mutationFn: ({ reason, reasonCode: code }: { reason: string; reasonCode: string }) =>
      cancelFn({ data: { rideId, reason, reasonCode: code } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ride", rideId] }),
  });

  const [showPayCard, setShowPayCard] = useState(false);
  const paying = useMutation({
    mutationFn: () => pushFn({ data: { rideId } }),
    onSuccess: () => {
      setShowPayCard(true);
      void queryClient.invalidateQueries({ queryKey: ["ride-payment", rideId] });
    },
  });

  const rating = useMutation({
    mutationFn: () => rateFn({ data: { rideId, score } }),
  });

  const liveStatus = rideQuery.data?.ride.status;
  useEffect(() => {
    if (!liveStatus) return;
    if (liveStatus === "driver_assigned") playAlert("status");
    if (liveStatus === "driver_arrived") playAlert("arrived");
  }, [liveStatus]);

  if (rideQuery.isPending) {
    return (
      <AppShell title="Your ride">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading your ride…</p>
      </AppShell>
    );
  }

  if (rideQuery.error) {
    return (
      <AppShell title="Your ride">
        <div className="px-4 py-6">
          <p className="text-sm text-destructive">{(rideQuery.error as Error).message}</p>
          <Link to="/rides" className="mt-3 inline-flex text-sm font-medium text-primary">
            Back to my rides
          </Link>
        </div>
      </AppShell>
    );
  }

  const { ride, quote, driver, vehicle, lastLocation, events, tracking } = rideQuery.data!;
  const copy = statusCopy[ride.status] ?? { title: ride.status, body: "" };
  const cancellable =
    !["trip_started", "trip_completed"].includes(ride.status) &&
    !ride.status.startsWith("cancelled");
  const paymentStatus = paymentQuery.data?.ride?.payment_status ?? ride.payment_status;
  const intent = paymentQuery.data?.intent ?? null;
  const awaitingPayment = ["pending", "initiating", "awaiting_confirmation", "processing"].includes(
    paymentStatus,
  );
  const waitedTooLong =
    awaitingPayment && waitingSince.current !== null && Date.now() - waitingSince.current >= 90000;
  const paymentFailed = ["failed", "cancelled", "timed_out"].includes(paymentStatus);
  const paymentFailure = intent?.failure_reason ?? null;
  const mpesaReceipt =
    (intent?.provider_response as { mpesa_receipt?: string } | null | undefined)?.mpesa_receipt ??
    null;

  return (
    <AppShell title={`${ride.trip_kind === "delivery" ? "Delivery" : "Ride"} ${ride.reference}`}>
      <div className="h-64 w-full border-b border-border">
        <MapPanel
          pickup={quote ? { lat: Number(quote.pickup_lat), lng: Number(quote.pickup_lng) } : null}
          dropoff={
            quote ? { lat: Number(quote.dropoff_lat), lng: Number(quote.dropoff_lng) } : null
          }
          polyline={quote?.polyline ?? null}
          driverRoutePolyline={tracking.routePolyline}
          driver={
            lastLocation
              ? {
                  lat: Number(lastLocation.lat),
                  lng: Number(lastLocation.lng),
                  accuracy_m: lastLocation.accuracy_m,
                }
              : null
          }
          className="h-64 w-full"
        />
      </div>

      <div className="mx-auto max-w-md px-4 py-4">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-semibold text-foreground">
            {ride.trip_kind === "delivery" &&
            ["driver_assigned", "driver_arriving"].includes(ride.status)
              ? "Your delivery driver is on the way"
              : ride.trip_kind === "delivery" && ride.status === "trip_started"
                ? "Delivery in progress"
                : copy.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {ride.trip_kind === "delivery" &&
            ["driver_assigned", "driver_arriving"].includes(ride.status)
              ? "Your delivery driver is approaching the pickup point."
              : copy.body}
          </p>
          {ride.status === "driver_arrived" ? (
            <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm font-semibold text-success">
              Your {ride.trip_kind === "delivery" ? "delivery driver" : "driver"} is at the pickup
              point.
            </p>
          ) : ["driver_assigned", "driver_arriving", "trip_started"].includes(ride.status) ? (
            <div className="mt-3 rounded-lg bg-primary/10 px-3 py-2">
              <p className="text-sm font-semibold text-foreground">
                {tracking.etaMinutes != null
                  ? ride.status === "trip_started"
                    ? `Estimated arrival at destination: about ${tracking.etaMinutes} min`
                    : `${ride.trip_kind === "delivery" ? "Delivery driver" : "Driver"} is about ${tracking.etaMinutes} min away`
                  : lastLocation
                    ? "Waiting for a fresh location to calculate arrival time…"
                    : "Waiting for the driver’s first live location…"}
              </p>
              {tracking.distanceKm != null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  About {tracking.distanceKm.toFixed(1)} km away by road.
                </p>
              ) : null}
              {tracking.locationUpdatedAt ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Location updated{" "}
                  {new Date(tracking.locationUpdatedAt).toLocaleTimeString("en-KE")}.
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="mt-3 font-display text-2xl font-semibold text-foreground">
            KES {Number(ride.total_fare).toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ride.payment_method === "cash" ? "Cash on arrival" : "M-PESA"} · payment{" "}
            {paymentStatus}
          </p>
          {Number(ride.cancellation_fee ?? 0) > 0 && (
            <p className="mt-2 text-xs text-warning">
              Cancellation fee applied: KES {Number(ride.cancellation_fee).toFixed(2)}
            </p>
          )}
        </section>

        {/* The driver may be dropping someone off nearby before starting yours. */}
        {ride.queued_after_ride_id && !ride.status.startsWith("cancelled") ? (
          <section className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              Your {ride.trip_kind === "delivery" ? "delivery driver" : "driver"} is close by,
              finishing another trip
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              They accepted your {ride.trip_kind === "delivery" ? "delivery" : "ride"} and will set
              off to your pickup point as soon as they drop off their current passenger nearby.
              We'll tell you the moment they're on the way.
            </p>
          </section>
        ) : null}

        {/* Stops the customer arranged along the way. */}
        {Array.isArray(quote?.stops) &&
        (quote.stops as { address?: string | null }[]).length > 0 ? (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Stops along the way</h3>
            <ol className="mt-2 space-y-1.5">
              {(quote!.stops as { address?: string | null }[]).map((stop, index) => (
                <li key={index} className="flex items-center gap-2 text-sm text-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="truncate">{stop.address ?? "Stop"}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {(driver || vehicle) && (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Your driver</h3>
            <div className="mt-2 flex items-center gap-3">
              {driver?.photoUrl ? (
                <img
                  src={driver.photoUrl}
                  alt={`Photo of ${driver.full_name ?? "your driver"}`}
                  className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-bold text-secondary-foreground">
                  {(driver?.full_name ?? "D").charAt(0).toUpperCase()}
                </span>
              )}
              <p className="text-sm font-semibold text-foreground">
                {driver?.full_name ?? "Assigned driver"}
              </p>
            </div>

            {vehicle && (
              <div className="mt-3">
                <CarBadge
                  colour={vehicle.colour}
                  plate={vehicle.plate_number}
 vehicleClass={vehicle.vehicle_class}
                  detail={
                    [vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(" ") || null
                  }
                />
              </div>
            )}
            {driver?.phone && (
              <a
                href={`tel:${driver.phone}`}
                className="mt-3 block w-full rounded-full bg-success px-4 py-2.5 text-center text-sm font-semibold text-white"
              >
                Call driver
              </a>
            )}
          </section>
        )}

        {driver ? (
          <div className="mt-4">
            <RideChat
              rideId={ride.id}
              counterpartName={driver.full_name ?? "your driver"}
              counterpartPhone={driver.phone}
              closed={ride.status === "trip_completed" || ride.status.startsWith("cancelled")}
            />
          </div>
        ) : null}

        {ride.status === "trip_completed" ? <><ReceiptActions rideId={ride.id} /><RideEtrRequest rideId={ride.id} /></> : null}

        {ride.payment_method === "stk_push" && paymentStatus === "paid" && (
          <section className="mt-4 rounded-xl border border-success/40 bg-success/10 p-4">
            <h3 className="text-sm font-semibold text-foreground">Payment received</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Twende Payments confirmed KES {Number(ride.total_fare).toFixed(2)} for this ride.
              {mpesaReceipt ? ` M-Pesa receipt ${mpesaReceipt}.` : ""}
            </p>
          </section>
        )}

        {ride.payment_method === "stk_push" &&
          !["paid", "not_required"].includes(paymentStatus) && (
            <section className="mt-4 rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Twende Payments</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Pay KES {Number(ride.total_fare).toFixed(2)} with M-Pesa.
              </p>
              {awaitingPayment ? (
                <div className="mt-3 rounded-md bg-secondary p-3">
                  <p className="text-sm font-medium text-foreground">
                    {waitedTooLong
                      ? "Your payment is still being confirmed. This page will automatically update once payment is received."
                      : "Check your phone for the M-Pesa prompt."}
                  </p>
                  {!waitedTooLong && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Enter your M-Pesa PIN to complete the payment.
                    </p>
                  )}
                </div>
              ) : null}
              <button
                onClick={() => paying.mutate()}
                disabled={paying.isPending}
                className="mt-3 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {paying.isPending
                  ? "Sending prompt…"
                  : awaitingPayment || paymentFailed
                    ? "Send the prompt again"
                    : "Pay with M-Pesa"}
              </button>
              {!awaitingPayment && <PayRideWithWallet rideId={ride.id} fare={Number(ride.total_fare)} />}
              {paymentFailed && paymentFailure && (
                <p className="mt-2 text-sm text-destructive">{paymentFailure}</p>
              )}
              {paying.data && !awaitingPayment && (
                <p
                  className={`mt-2 text-sm ${paying.data.blocked ? "text-warning" : "text-muted-foreground"}`}
                >
                  {paying.data.message}
                </p>
              )}
              {paying.isError && (
                <p className="mt-2 text-sm text-destructive">{(paying.error as Error).message}</p>
              )}
            </section>
          )}

        {cancellable && (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            {!showCancel ? (
              <>
                <h3 className="text-sm font-semibold text-foreground">Need to cancel?</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  You can cancel before the trip starts. A fee may apply after the free window on an
                  assigned ride.
                </p>
                <button
                  onClick={() => setShowCancel(true)}
                  className="mt-3 w-full rounded-md border border-destructive px-4 py-3 text-sm font-semibold text-destructive"
                >
                  Cancel this ride
                </button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-foreground">Why are you cancelling?</h3>
                <label
                  className="mt-3 block text-xs font-medium text-muted-foreground"
                  htmlFor="cancel-reason"
                >
                  Reason for cancelling
                </label>
                <select
                  id="cancel-reason"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {cancelReasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
                <textarea
                  value={reasonNote}
                  onChange={(event) => setReasonNote(event.target.value)}
                  placeholder={
                    reasonCode === "Other"
                      ? "Please tell us what happened"
                      : "Anything else? (optional)"
                  }
                  rows={2}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() =>
                      cancelling.mutate({
                        reasonCode,
                        reason: reasonNote.trim() || reasonCode,
                      })
                    }
                    disabled={
                      cancelling.isPending ||
                      (reasonCode === "Other" && reasonNote.trim().length < 3)
                    }
                    className="flex-1 rounded-md bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
                  >
                    {cancelling.isPending ? "Cancelling…" : "Confirm cancellation"}
                  </button>
                  <button
                    onClick={() => setShowCancel(false)}
                    disabled={cancelling.isPending}
                    className="rounded-md border border-border px-4 py-3 text-sm font-medium text-foreground disabled:opacity-60"
                  >
                    Go back
                  </button>
                </div>
                {cancelling.isError && (
                  <p className="mt-2 text-sm text-destructive">
                    {(cancelling.error as Error).message}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {(ride.status === "no_driver_found" || ride.status === "expired") && paymentStatus === "paid" ? (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">No driver reached you — your KES {Number(ride.total_fare).toLocaleString("en-KE")} is safe</h3>
            <p className="mt-1 text-xs text-muted-foreground">Retry the same trip with the same amount (no new M-PESA prompt), keep it in your Twende wallet, or get it back.</p>
            {creditState.data?.retryRideId ? (
              <Link to="/rides/$rideId" params={{ rideId: creditState.data.retryRideId }} className="mt-3 block rounded-md bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground">Open your retried ride</Link>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <button
                  onClick={() => retrying.mutate()}
                  disabled={retrying.isPending}
                  className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {retrying.isPending ? "Finding a driver…" : `Retry with KES ${Number(ride.total_fare).toLocaleString("en-KE")} already paid`}
                </button>
                {creditState.data?.credited || keeping.isSuccess ? (
                  <Link to="/account" className="rounded-md border border-border px-4 py-3 text-center text-sm font-semibold text-foreground">In your wallet — open Account to refund</Link>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => keeping.mutate()}
                      disabled={keeping.isPending}
                      className="flex-1 rounded-md border border-border px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-60"
                    >
                      {keeping.isPending ? "Saving…" : "Keep in wallet"}
                    </button>
                    <button
                      onClick={() => refunding.mutate()}
                      disabled={refunding.isPending || refunding.isSuccess}
                      className="flex-1 rounded-md border border-border px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-60"
                    >
                      {refunding.isSuccess ? "Refund requested" : refunding.isPending ? "Requesting…" : "Refund to M-PESA"}
                    </button>
                  </div>
                )}
              </div>
            )}
            {[retrying, keeping, refunding].map((m, i) => m.isError ? <p key={i} className="mt-2 text-sm text-destructive">{(m.error as Error).message}</p> : null)}
          </section>
        ) : ride.status.startsWith("cancelled") || ride.status === "no_driver_found" || ride.status === "expired" ? (
          <>
            {paymentStatus === "refund_pending" && <p className="mt-4 text-center text-xs text-muted-foreground">Your refund is being processed.</p>}
            <Link
              to="/book"
              className="mt-4 block w-full rounded-md bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground"
            >
              Request another ride
            </Link>
          </>
        ) : null}

        {ride.status === "trip_completed" && <RateTrip rideId={ride.id} />}
        {ride.driver_id && <TripComplaint rideId={ride.id} reference={ride.reference} />}

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Ride timeline</h3>
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
            {events.map((event) => (
              <li key={event.id} className="flex justify-between gap-3">
                <span>{statusCopy[event.status]?.title ?? event.status}</span>
                <span>{new Date(event.created_at).toLocaleTimeString("en-KE")}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <PaymentProgressCard
        open={showPayCard}
        amount={Number(ride.total_fare)}
        phone={intent?.msisdn ?? null}
        check={async (): Promise<PayState> => {
          const r = await fetchPayment({ data: { rideId } });
          void queryClient.invalidateQueries({ queryKey: ["ride-payment", rideId] });
          const st = String(r?.ride?.payment_status ?? r?.intent?.status ?? "pending");
          if (st === "paid") return "paid";
          if (["failed", "cancelled", "timed_out"].includes(st)) return "failed";
          return "pending";
        }}
        onSuccess={() => setShowPayCard(false)}
        onRetry={() => paying.mutate()}
        onClose={() => setShowPayCard(false)}
        successLabel="Done"
      />
    </AppShell>
  );
}

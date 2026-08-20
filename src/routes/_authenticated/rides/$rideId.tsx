import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MapPanel } from "@/components/MapPanel";
import { supabase } from "@/integrations/supabase/client";
import { cancelRide, getRide, rateRide } from "@/lib/rides.functions";
import { getPaymentStatus, startStkPush } from "@/lib/payments.functions";

export const Route = createFileRoute("/_authenticated/rides/$rideId")({
  head: () => ({
    meta: [
      { title: "Track your taxi — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Watch your Twende Ride driver approach in real time, see the locked fare, pay by M-PESA or cancel.",
      },
      { property: "og:title", content: "Track your taxi — Twende Ride" },
      { property: "og:description", content: "Live driver approach tracking and payment for your Meru taxi." },
    ],
  }),
  component: RideDetail,
});

const statusCopy: Record<string, { title: string; body: string }> = {
  searching: { title: "Finding a driver", body: "We are offering your ride to nearby drivers." },
  driver_assigned: { title: "Driver on the way", body: "Your driver is approaching the pickup pin." },
  driver_arrived: { title: "Driver has arrived", body: "Your driver is waiting at the pickup pin." },
  trip_started: { title: "On trip", body: "Enjoy the ride — the fare is already locked." },
  trip_completed: { title: "Trip completed", body: "Thanks for riding with Twende." },
  cancelled_by_customer: { title: "Cancelled", body: "You cancelled this ride." },
  cancelled_by_driver: { title: "Cancelled by driver", body: "The driver cancelled. No fare is due." },
  cancelled_by_ops: { title: "Cancelled by operations", body: "Operations cancelled this ride." },
  no_driver_found: { title: "No driver found", body: "No driver was available nearby. Nothing was charged." },
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

  const rideQuery = useQuery({
    queryKey: ["ride", rideId],
    queryFn: () => fetchRide({ data: { rideId } }),
    refetchInterval: 15000,
  });

  const paymentQuery = useQuery({
    queryKey: ["ride-payment", rideId],
    queryFn: () => fetchPayment({ data: { rideId } }),
    refetchInterval: 20000,
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
        { event: "INSERT", schema: "public", table: "ride_locations", filter: `ride_id=eq.${rideId}` },
        () => queryClient.invalidateQueries({ queryKey: ["ride", rideId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, rideId]);

  const cancelling = useMutation({
    mutationFn: (reason: string) => cancelFn({ data: { rideId, reason } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ride", rideId] }),
  });

  const paying = useMutation({
    mutationFn: () => pushFn({ data: { rideId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ride-payment", rideId] }),
  });

  const rating = useMutation({
    mutationFn: () => rateFn({ data: { rideId, score } }),
  });

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

  const { ride, quote, driver, vehicle, lastLocation, events } = rideQuery.data!;
  const copy = statusCopy[ride.status] ?? { title: ride.status, body: "" };
  const cancellable = !["trip_started", "trip_completed"].includes(ride.status) && !ride.status.startsWith("cancelled");
  const paymentStatus = paymentQuery.data?.ride?.payment_status ?? ride.payment_status;

  return (
    <AppShell title={`Ride ${ride.reference}`}>
      <div className="h-64 w-full border-b border-border">
        <MapPanel
          pickup={quote ? { lat: Number(quote.pickup_lat), lng: Number(quote.pickup_lng) } : null}
          dropoff={quote ? { lat: Number(quote.dropoff_lat), lng: Number(quote.dropoff_lng) } : null}
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
          <h2 className="font-display text-lg font-semibold text-foreground">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
          <p className="mt-3 font-display text-2xl font-semibold text-foreground">
            KES {Number(ride.total_fare).toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ride.payment_method === "cash" ? "Cash on arrival" : "M-PESA"} · payment {paymentStatus}
          </p>
          {Number(ride.cancellation_fee ?? 0) > 0 && (
            <p className="mt-2 text-xs text-warning">
              Cancellation fee applied: KES {Number(ride.cancellation_fee).toFixed(2)}
            </p>
          )}
        </section>

        {(driver || vehicle) && (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Your driver</h3>
            <p className="mt-1 text-sm text-foreground">{driver?.full_name ?? "Assigned driver"}</p>
            {driver?.phone && (
              <a href={`tel:${driver.phone}`} className="mt-1 inline-flex text-sm font-medium text-primary">
                Call {driver.phone}
              </a>
            )}
            {vehicle && (
              <p className="mt-2 text-xs text-muted-foreground">
                {[vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(" ")} ·{" "}
                {vehicle.plate_number}
              </p>
            )}
          </section>
        )}

        {ride.payment_method === "stk_push" && !["paid", "not_required"].includes(paymentStatus) && (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Pay with M-PESA</h3>
            <button
              onClick={() => paying.mutate()}
              disabled={paying.isPending}
              className="mt-3 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {paying.isPending ? "Requesting…" : "Send STK Push"}
            </button>
            {paying.data && (
              <p className={`mt-2 text-sm ${paying.data.blocked ? "text-warning" : "text-muted-foreground"}`}>
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
            <h3 className="text-sm font-semibold text-foreground">Need to cancel?</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              A cancellation fee only applies after the free window on an assigned ride.
            </p>
            <button
              onClick={() => cancelling.mutate("Cancelled from the ride screen")}
              disabled={cancelling.isPending}
              className="mt-3 w-full rounded-md border border-destructive px-4 py-3 text-sm font-semibold text-destructive disabled:opacity-60"
            >
              {cancelling.isPending ? "Cancelling…" : "Cancel this ride"}
            </button>
            {cancelling.isError && (
              <p className="mt-2 text-sm text-destructive">{(cancelling.error as Error).message}</p>
            )}
          </section>
        )}

        {ride.status === "trip_completed" && (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Rate your driver</h3>
            <div className="mt-2 flex gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  onClick={() => setScore(value)}
                  className={`h-10 flex-1 rounded-md text-sm font-semibold ${
                    score >= value ? "bg-gold text-gold-foreground" : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <button
              onClick={() => rating.mutate()}
              disabled={rating.isPending || rating.isSuccess}
              className="mt-3 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {rating.isSuccess ? "Thank you" : rating.isPending ? "Sending…" : "Submit rating"}
            </button>
            {rating.isError && (
              <p className="mt-2 text-sm text-destructive">{(rating.error as Error).message}</p>
            )}
          </section>
        )}

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
    </AppShell>
  );
}

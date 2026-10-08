import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppShell, driverTabs } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { MapPanel } from "@/components/MapPanel";
import { RideChat } from "@/components/RideChat";
import { CarBadge } from "@/components/CarBadge";
import { PushSettings } from "@/components/PushSettings";
import { HireRequestsBoard } from "@/components/HireRequestsBoard";
import { HireVehicleManager } from "@/components/HireVehicleManager";
import { HirePortfolioFinance } from "@/components/HirePortfolioFinance";
import { supabase } from "@/integrations/supabase/client";
import {
  acceptOffer,
  advanceRide,
  confirmCashCollected,
  declineOffer,
  getDriverHome,
  pushDriverLocation,
  setActiveVehicle,
  setDriverOnline,
  claimRide,
  requestCustomerPayment,
  listOpenRides,
} from "@/lib/driver.functions";
import { playAlert, primeAudio, stopAlert } from "@/lib/audio";

export const Route = createFileRoute("/_authenticated/driver/")({
  head: () => ({
    meta: [
      { title: "Driver console — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Go online, accept nearby ride offers, run the trip lifecycle and track your Twende Meru Rides earnings in Meru.",
      },
      { property: "og:title", content: "Driver console — Twende Meru Rides" },
      { property: "og:description", content: "Accept offers, run trips and see earnings as a Twende Meru Rides driver." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DriverConsolePage,
});

const nextLabel: Record<string, { next: "driver_arriving" | "driver_arrived" | "trip_started" | "trip_completed"; label: string }> = {
  driver_assigned: { next: "driver_arriving", label: "Start heading to pickup" },
  driver_arriving: { next: "driver_arrived", label: "I have arrived" },
  driver_arrived: { next: "trip_started", label: "Start trip" },
  trip_started: { next: "trip_completed", label: "Complete trip" },
};

function DriverConsolePage() {
  return (
    <RoleGate
      allow={["driver"]}
      title="Driver console"
      hint="The driver console opens once operations approve your application."
      actionTo="/driver/apply"
      actionLabel="Start driver onboarding"
      fallback={<HireOwnerPortal />}
    >
      <DriverHome />
    </RoleGate>
  );
}

function HireOwnerPortal() {
  return (
    <AppShell title="List a vehicle for hire">
      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <section className="surface-card p-4">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Offer your vehicle for hire
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You can add and manage a hire car here without becoming a driver for ride requests.
            Vehicle approval and hire-listing inspection are separate Ops reviews.
          </p>
          <Link to="/driver/apply" className="mt-3 inline-flex text-sm font-semibold text-primary">
            Interested in driving rides? Apply separately →
          </Link>
        </section>
        <HireVehicleManager hireOnly />
        <HireRequestsBoard />
        <HirePortfolioFinance />
      </div>
    </AppShell>
  );
}

function DriverHome() {
  const queryClient = useQueryClient();
  const fetchHome = useServerFn(getDriverHome);
  const onlineFn = useServerFn(setDriverOnline);
  const vehicleFn = useServerFn(setActiveVehicle);
  const acceptFn = useServerFn(acceptOffer);
  const declineFn = useServerFn(declineOffer);
  const advanceFn = useServerFn(advanceRide);
  const cashFn = useServerFn(confirmCashCollected);
  const pingFn = useServerFn(pushDriverLocation);
  const openFn = useServerFn(listOpenRides);
  const claimFn = useServerFn(claimRide);

  const openRides = useQuery({
    queryKey: ["driver-open-rides"],
    queryFn: () => openFn({}),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const home = useQuery({ queryKey: ["driver-home"], queryFn: () => fetchHome({}), refetchInterval: 15000 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["driver-home"] });

  const driverId = home.data?.driver?.id;
  const activeRideId = home.data?.activeRide?.id ?? null;
  const isOnline = home.data?.driver?.is_online ?? false;

  // Realtime offers + ride status keep the console live between polls.
  useEffect(() => {
    if (!driverId) return;
    const channel = supabase
      .channel(`driver:${driverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_offers", filter: `driver_id=eq.${driverId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides", filter: `driver_id=eq.${driverId}` },
        invalidate,
      )
      // Any new or changed request should refresh the open board straight away.
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["driver-open-rides"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [driverId]);

  // Ping location while online so dispatch and the customer map stay accurate.
  useEffect(() => {
    if (!isOnline || typeof navigator === "undefined" || !navigator.geolocation) return;
    const send = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void pingFn({
            data: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: Math.round(pos.coords.accuracy),
              ...(activeRideId ? { rideId: activeRideId } : {}),
            },
          });
        },
        () => undefined,
        { enableHighAccuracy: true, timeout: 10000 },
      );
    send();
    const timer = setInterval(send, 20000);
    return () => clearInterval(timer);
  }, [isOnline, activeRideId, pingFn]);

  const toggling = useMutation({
    mutationFn: (online: boolean) => onlineFn({ data: { online } }),
    onSuccess: invalidate,
  });
  const choosingVehicle = useMutation({
    mutationFn: (vehicleId: string) => vehicleFn({ data: { vehicleId } }),
    onSuccess: invalidate,
  });
  const accepting = useMutation({
    mutationFn: (offerId: string) => acceptFn({ data: { offerId } }),
    onSuccess: invalidate,
  });
  const declining = useMutation({
    mutationFn: (offerId: string) => declineFn({ data: { offerId } }),
    onSuccess: invalidate,
  });
  const advancing = useMutation({
    mutationFn: (vars: { rideId: string; next: "driver_arriving" | "driver_arrived" | "trip_started" | "trip_completed" | "cancelled_by_driver" }) =>
      advanceFn({ data: vars }),
    onSuccess: invalidate,
  });
  const askPaymentFn = useServerFn(requestCustomerPayment);
  const askPayment = useMutation({
    mutationFn: (rideId: string) => askPaymentFn({ data: { rideId } }),
    onSuccess: invalidate,
  });
  const cash = useMutation({
    mutationFn: (rideId: string) => cashFn({ data: { rideId } }),
    onSuccess: invalidate,
  });
  const claiming = useMutation({
    mutationFn: (rideId: string) => claimFn({ data: { rideId } }),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["driver-open-rides"] });
    },
  });

  const offerCount = home.data?.offers.length ?? 0;
  const openCount = openRides.data?.rides.length ?? 0;
  useEffect(() => {
    // Ring while an offer is on screen; go quiet the moment it is gone.
    if (offerCount > 0) playAlert("offer");
    else stopAlert();
  }, [offerCount]);
  useEffect(() => {
    if (openCount > 0) playAlert("status");
  }, [openCount]);

  if (home.isPending) {
    return (
      <AppShell title="Driver console" tabs={driverTabs} eyebrow="Twende Driver">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading your console…</p>
      </AppShell>
    );
  }

  if (home.error) {
    return (
      <AppShell title="Driver console" tabs={driverTabs} eyebrow="Twende Driver">
        <p className="px-4 py-6 text-sm text-destructive">{(home.error as Error).message}</p>
      </AppShell>
    );
  }

  const {
    driver,
    vehicles,
    wallet,
    offers,
    activeRide,
    activeRoute,
    queuedRide,
    queuedRoute,
    customer,
    recent,
    documents,
    activeVehicleHire,
  } = home.data!;

  if (!driver) {
    return (
      <AppShell title="Driver console" tabs={driverTabs} eyebrow="Twende Driver">
        <div className="hero-gradient min-h-[60vh] px-4 py-10">
          <div className="glass-strong mx-auto max-w-md p-6">
            <h2 className="font-display text-xl font-semibold text-foreground">Driver access pending</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This account has no driver profile yet. Register your vehicle and documents, then operations will review
              and approve you before you can go online.
            </p>
            <Link
              to="/driver/apply"
              className="mt-4 inline-flex rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Start driver onboarding
            </Link>
            <Link to="/book" className="mt-3 block text-sm font-medium text-primary">
              Back to booking
            </Link>

          </div>
        </div>
      </AppShell>
    );
  }

  const step = activeRide ? nextLabel[activeRide.status] : undefined;

  return (
    <AppShell title="Driver console" tabs={driverTabs} eyebrow="Twende Driver">
      <div className="hero-gradient px-4 pb-8 pt-5">
        <div className="mx-auto max-w-md space-y-4">
          {/* Availability */}
          <section className="glass p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-foreground/70">
                  Availability
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-brand-foreground">
                  {driver.is_online ? "You are online" : "You are offline"}
                </h2>
                <p className="mt-1 text-xs text-brand-foreground/70">
                  Status: {driver.status} · rating {Number(driver.rating ?? 5).toFixed(1)}
                </p>
              </div>
              <button
                onClick={() => toggling.mutate(!driver.is_online)}
                disabled={toggling.isPending}
                className={`relative h-9 w-16 shrink-0 rounded-full border border-white/30 transition-colors ${
                  driver.is_online ? "bg-success" : "bg-white/25"
                } disabled:opacity-60`}
                aria-label={driver.is_online ? "Go offline" : "Go online"}
              >
                <span
                  className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-all ${
                    driver.is_online ? "left-8" : "left-1"
                  }`}
                />
              </button>
            </div>
            {toggling.data?.blockers?.length ? (
              <ul className="mt-3 space-y-1 text-xs text-warning-foreground">
                {toggling.data.blockers.map((blocker) => (
                  <li key={blocker} className="rounded-lg bg-warning/80 px-2.5 py-1.5">
                    {blocker}
                  </li>
                ))}
              </ul>
            ) : null}
            {activeVehicleHire ? (
              <p className="mt-3 rounded-xl border border-warning/30 bg-warning/15 px-3 py-2 text-xs font-medium text-warning-foreground">
                This vehicle is on hire until {new Date(activeVehicleHire.end_at ?? new Date(new Date(activeVehicleHire.start_at).getTime() + activeVehicleHire.days * 86_400_000)).toLocaleString("en-KE")}. Ride offers are paused until it is returned.
              </p>
            ) : null}
          </section>

          {/* Vehicle + wallet */}
          <div className="grid grid-cols-2 gap-3">
            <section className="glass p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-foreground/70">Wallet</p>
              <p className="mt-1 font-display text-lg font-semibold text-brand-foreground">
                KES {Number(wallet?.cached_balance ?? 0).toFixed(2)}
              </p>
              <Link to="/driver/wallet" className="mt-1 inline-flex text-xs font-medium text-brand-foreground/80">
                Withdraw →
              </Link>
            </section>
            <section className="glass p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-foreground/70">
                Documents
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-brand-foreground">
                {documents.filter((d) => d.status === "approved").length}/{documents.length || 0}
              </p>
              <p className="mt-1 text-xs text-brand-foreground/70">approved</p>
              <p className="mt-1 text-[11px] text-brand-foreground/70">
                Upload or renew your compliance documents for Operations review.
              </p>
              <Link
                to="/driver/apply"
                hash="compliance-documents"
                className="mt-2 inline-flex text-xs font-semibold text-brand-foreground"
              >
                Upload or renew documents →
              </Link>
            </section>
          </div>

          <section className="glass p-5">
            <h3 className="text-sm font-semibold text-brand-foreground">Active vehicle</h3>
            {vehicles.length === 0 && (
              <p className="mt-2 text-xs text-brand-foreground/75">
                No vehicle assigned yet. Your fleet owner or operations must add one.
              </p>
            )}
            <div className="mt-3 space-y-2">
              {vehicles.map((vehicle) => {
                const active = driver.active_vehicle_id === vehicle.id;
                return (
                  <button
                    key={vehicle.id}
                    onClick={() => choosingVehicle.mutate(vehicle.id)}
                    className={`w-full rounded-2xl px-3.5 py-3 text-left text-sm transition-colors ${
                      active
                        ? "bg-white/85 text-foreground"
                        : "border border-white/20 bg-white/15 text-brand-foreground"
                    }`}
                  >
                    <CarBadge
                      colour={vehicle.colour}
                      plate={vehicle.plate_number}
                      detail={[vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(" ") || null}
                    />

                    <span className="mt-0.5 block text-xs opacity-75">
                      {vehicle.vehicle_class} · {vehicle.status}
                      {active ? " · active" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        {/* Live offers */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Ride offers</h3>
          {offers.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {driver.is_online ? "Waiting for nearby requests…" : "Go online to receive ride offers."}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {offers.map((offer) => (
                <li key={offer.id} className="rounded-2xl border border-border bg-secondary/50 p-3">
                  <p className="font-display text-base font-semibold text-foreground">
                    {Number(offer.distance_km ?? 0).toFixed(1)} km to pickup
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    ETA {offer.eta_minutes ?? "—"} min · expires{" "}
                    {new Date(offer.expires_at).toLocaleTimeString("en-KE")}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => accepting.mutate(offer.id)}
                      disabled={accepting.isPending}
                      className="flex-1 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {accepting.isPending ? "Accepting…" : "Accept"}
                    </button>
                    <button
                      onClick={() => declining.mutate(offer.id)}
                      disabled={declining.isPending}
                      className="rounded-full border border-input px-4 py-2.5 text-sm font-medium text-muted-foreground disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {accepting.data && !accepting.data.ok && (
            <p className="mt-2 text-xs text-warning">This offer is no longer available ({accepting.data.reason}).</p>
          )}
        </section>

        {/* Open ride board */}
        <section className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Available ride requests</h3>
              <p className="text-[11px] text-muted-foreground">
                {openRides.isFetching
                  ? "Refreshing…"
                  : openRides.dataUpdatedAt
                    ? `Updated ${new Date(openRides.dataUpdatedAt).toLocaleTimeString()}`
                    : "Waiting for requests"}
              </p>
            </div>
            <button
              onClick={() => {
                primeAudio();
                void openRides.refetch();
              }}
              disabled={openRides.isFetching}
              className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground disabled:opacity-60"
            >
              {openRides.isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {openRides.data && !openRides.data.eligible ? (
            <p className="mt-2 text-xs text-warning">{openRides.data.reason}</p>
          ) : openRides.data && openRides.data.rides.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No open requests right now.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {(openRides.data?.rides ?? []).map((request) => (
                <li key={request.id} className="rounded-2xl border border-border bg-secondary/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {request.pickup_address ?? "Pickup pin"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        to {request.dropoff_address ?? "destination pin"}
                      </p>
                    </div>
                    <p className="shrink-0 font-display text-base font-semibold text-foreground">
                      KES {request.total_fare.toFixed(0)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {request.distance_km?.toFixed(1) ?? "—"} km · {Math.round(request.duration_minutes ?? 0)} min ·{" "}
                    {request.vehicle_class ?? "any"} · {request.payment_method === "cash" ? "Cash" : "M-PESA"}
                  </p>
                  <button
                    onClick={() => {
                      primeAudio();
                      claiming.mutate(request.id);
                    }}
                    disabled={claiming.isPending}
                    className="mt-3 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {claiming.isPending ? "Claiming…" : "Accept this ride"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {claiming.data && !claiming.data.ok && (
            <p className="mt-2 text-xs text-warning">{claiming.data.reason}</p>
          )}
        </section>

        {/* Active trip */}
        {activeRide && (
          <section className="surface-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Current trip · {activeRide.reference}</h3>
            <p className="mt-1 font-display text-2xl font-semibold text-foreground">
              KES {Number(activeRide.total_fare).toFixed(2)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {activeRide.payment_method === "cash" ? "Cash on arrival" : "M-PESA"} · {activeRide.status}
            </p>
            {activeRoute && (
              <div className="mt-3 space-y-2">
                <div className="overflow-hidden rounded-2xl border border-border">
                  <MapPanel
                    pickup={activeRoute.pickup}
                    dropoff={activeRoute.dropoff}
                    polyline={activeRoute.polyline}
                    className="h-52 w-full"
                  />
                </div>
                <div className="rounded-2xl bg-secondary/60 p-3 text-xs">
                  <p className="text-muted-foreground">
                    Pickup:{" "}
                    <span className="font-medium text-foreground">
                      {activeRoute.pickup_address ?? "pin on the map"}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Drop-off:{" "}
                    <span className="font-medium text-foreground">
                      {activeRoute.dropoff_address ?? "pin on the map"}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Trip distance {activeRoute.distance_km.toFixed(1)} km
                    {activeRoute.pickup_notes ? ` · note: ${activeRoute.pickup_notes}` : ""}
                  </p>
                </div>
              </div>
            )}
            <Link
              to="/rides/$rideId"
              params={{ rideId: activeRide.id }}
              className="mt-2 inline-flex text-xs font-medium text-primary"
            >
              Open ride map →
            </Link>
            {step && (
              <button
                onClick={() => advancing.mutate({ rideId: activeRide.id, next: step.next })}
                disabled={advancing.isPending}
                className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {advancing.isPending ? "Updating…" : step.label}
              </button>
            )}
            {activeRide.payment_method === "cash" && activeRide.status === "trip_started" && (
              <button
                onClick={() => cash.mutate(activeRide.id)}
                disabled={cash.isPending}
                className="mt-2 w-full rounded-full border border-input px-4 py-3 text-sm font-medium text-foreground disabled:opacity-60"
              >
                {cash.isSuccess ? "Cash recorded" : "Confirm cash collected"}
              </button>
            )}
            {activeRide.status === "trip_started" && activeRide.payment_status !== "paid" && (
              <>
                <button
                  onClick={() => askPayment.mutate(activeRide.id)}
                  disabled={askPayment.isPending}
                  className="mt-2 w-full rounded-full border border-input px-4 py-3 text-sm font-medium text-foreground disabled:opacity-60"
                >
                  {askPayment.isPending ? "Sending prompt…" : "Ask customer to pay via M-PESA"}
                </button>
                {askPayment.data ? (
                  <p className="mt-1 text-xs text-muted-foreground">{askPayment.data.message}</p>
                ) : null}
                {askPayment.isError ? (
                  <p className="mt-1 text-xs text-destructive">{(askPayment.error as Error).message}</p>
                ) : null}
              </>
            )}
            {activeRide.status !== "trip_started" && (
              <button
                onClick={() =>
                  advancing.mutate({ rideId: activeRide.id, next: "cancelled_by_driver" })
                }
                disabled={advancing.isPending}
                className="mt-2 w-full rounded-full border border-destructive px-4 py-3 text-sm font-medium text-destructive disabled:opacity-60"
              >
                Cancel this trip
              </button>
            )}
            {advancing.isError && (
              <p className="mt-2 text-xs text-destructive">{(advancing.error as Error).message}</p>
            )}
            <div className="mt-4">
              <RideChat
                rideId={activeRide.id}
                counterpartName={customer?.full_name ?? "your passenger"}
                counterpartPhone={customer?.phone ?? null}
              />
            </div>

          </section>
        )}

        {/* A job lined up behind the current trip. */}
        {queuedRide && (
          <section className="surface-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Next up · {queuedRide.reference}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Waiting for you to finish the current trip. Head there as soon as you drop off — the customer already
              knows you're close by.
            </p>
            {queuedRoute && (
              <p className="mt-2 text-sm text-foreground">
                Pick up at {queuedRoute.pickup_address ?? "pin on the map"} → {queuedRoute.dropoff_address ?? "pin on the map"}{" "}
                ({queuedRoute.distance_km.toFixed(1)} km)
              </p>
            )}
            <p className="mt-2 font-display text-lg font-semibold text-foreground">
              KES {Number(queuedRide.total_fare).toFixed(2)}
            </p>
          </section>
        )}



        <PushSettings />

        {/* Recent */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Recent trips</h3>
          {recent.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No completed trips yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {recent.map((ride) => (
                <li key={ride.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{ride.reference}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(ride.requested_at).toLocaleString("en-KE")} · {ride.status}
                    </p>
                  </div>
                  <p className="font-display text-sm font-semibold text-foreground">
                    KES {Number(ride.total_fare).toFixed(2)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <HireRequestsBoard />
        <HireVehicleManager />
        <HirePortfolioFinance />
      </div>
    </AppShell>
  );
}

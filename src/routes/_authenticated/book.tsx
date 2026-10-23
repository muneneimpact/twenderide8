import { Bike, Car } from "lucide-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MapPanel } from "@/components/MapPanel";
import {
  createDeliveryQuote,
  createQuote,
  estimateClasses,
  requestRide,
  reverseGeocode,
} from "@/lib/rides.functions";
import { getDeliveryOptions } from "@/lib/delivery.functions";
import { validatePromoCode } from "@/lib/admin.functions";
import type { PromoState } from "@/lib/discounts";
import { PlaceSearch } from "@/components/PlaceSearch";
import { nearbyDrivers } from "@/lib/nearby.functions";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/useMe";

export const Route = createFileRoute("/_authenticated/book")({
  head: () => ({
    meta: [
      { title: "Book a taxi — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Set your pickup pin and destination, add stops along the way, then choose your ride and pay by M-PESA or cash.",
      },
      { property: "og:title", content: "Book a taxi — Twende Meru Rides" },
      {
        property: "og:description",
        content: "Map-led taxi booking in Meru with a locked, itemised fare.",
      },
    ],
  }),
  component: BookPage,
});

type VehicleClass = "boda" | "e_boda" | "go" | "plus" | "comfort" | "xl";

const CLASS_LABELS: Record<VehicleClass, { name: string; hint: string }> = {
  boda: { name: "Twende Boda", hint: "One rider, quickest" },
  e_boda: { name: "Twende E-Boda", hint: "Electric bike, cleaner ride" },
  go: { name: "Twende Go", hint: "Everyday saloon car" },
  plus: { name: "Twende Plus", hint: "Extra space and comfort" },
  comfort: { name: "Twende Comfort", hint: "Newer, roomier car" },
  xl: { name: "Twende XL", hint: "Up to 6 seats" },
};

/** Sending a parcel uses the same cars and bodas, under their own names. */
const DELIVERY_LABELS: Partial<Record<VehicleClass, { name: string; hint: string }>> = {
  boda: { name: "Twende Delivery Boda", hint: "Small parcels, fastest across town" },
  go: { name: "Twende Delivery Car", hint: "Bigger or fragile items" },
};

interface Point {
  lat: number;
  lng: number;
  label?: string | null;
  address?: string | null;
}

const RECENTS_KEY = "twende.recent-destinations";

/** Recent destinations are a convenience only, so they live on the device. */
function readRecents(): Point[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Point[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function writeRecents(points: Point[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(points.slice(0, 5)));
  } catch {
    // A full or blocked storage quota must never break booking.
  }
}

function label(point: Point | null) {
  if (!point) return "Not set";
  return point.label ?? point.address ?? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function BookPage() {
  const navigate = useNavigate();
  const reverse = useServerFn(reverseGeocode);
  const estimateFn = useServerFn(estimateClasses);
  const quoteFn = useServerFn(createQuote);
  const deliveryQuoteFn = useServerFn(createDeliveryQuote);
  const deliveryOptionsFn = useServerFn(getDeliveryOptions);
  const requestFn = useServerFn(requestRide);
  const nearbyFn = useServerFn(nearbyDrivers);
  const { me } = useMe();

  // Two screens: say where you're going, then choose the ride and pay.
  const [step, setStep] = useState<"where" | "ride">("where");
  const [placing, setPlacing] = useState<"pickup" | "dropoff">("dropoff");
  const [locating, setLocating] = useState(true);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [stops, setStops] = useState<Point[]>([]);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("go");
  const [pickupNotes, setPickupNotes] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stk_push" | "cash">("stk_push");
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [tripKind, setTripKind] = useState<"ride" | "delivery">("ride");
  const [deliveryFleetId, setDeliveryFleetId] = useState<string | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [msisdn, setMsisdn] = useState("");
  const [msisdnTouched, setMsisdnTouched] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<"pickup" | "dropoff" | "stop">("dropoff");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const [recents, setRecents] = useState<Point[]>(() => readRecents());
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    name: string;
    discount_percent: number;
    discount_amount: number;
    total_before_discount: number;
    total_fare: number;
    promotionId: string;
  } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [, setPromoStatus] = useState<PromoState | null>(null);

  // The M-PESA number defaults to the verified phone on the account.
  useEffect(() => {
    const phone = me?.profile?.phone;
    if (phone && !msisdnTouched && msisdn.length === 0) setMsisdn(phone);
  }, [me?.profile?.phone, msisdnTouched, msisdn.length]);

  // Whatever you chose on your account is already selected here, so paying
  // by cash is one less tap. M-PESA stands in when nothing is saved.
  useEffect(() => {
    const preference = me?.profile?.payment_preference;
    if (!paymentTouched && preference === "cash") setPaymentMethod("cash");
  }, [me?.profile?.payment_preference, paymentTouched]);

  // Saved places live with the customer, so Home and Office survive devices.
  const saved = useQuery({
    queryKey: ["saved-places"],
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_places")
        .select("id, label, address, lat, lng")
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  const resolvePoint = useCallback(
    async (point: { lat: number; lng: number }) => {
      // Geolocation can resolve during the brief hand-off between the route
      // guard and client auth hydration. Never call a protected server
      // function until the bearer token is available.
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) return null;
      return reverse({ data: point });
    },
    [reverse],
  );

  const stopPayload = () =>
    stops.map((stop) => ({ lat: stop.lat, lng: stop.lng, address: label(stop) }));

  const estimating = useMutation({
    mutationFn: () =>
      estimateFn({
        data: {
          pickup: { lat: pickup!.lat, lng: pickup!.lng },
          dropoff: { lat: dropoff!.lat, lng: dropoff!.lng },
          stops: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
        },
      }),
  });

  const estimates = estimating.data?.options ?? [];
  const chosen = estimates.find((item) => item.vehicleClass === vehicleClass);
  const deliveryOptionsQuery = useQuery({
    queryKey: [
      "delivery-options",
      pickup?.lat,
      pickup?.lng,
      dropoff?.lat,
      dropoff?.lng,
      stops.map(({ lat, lng }) => [lat, lng]),
      tripKind,
    ],
    queryFn: () =>
      deliveryOptionsFn({
        data: {
          pickup: { lat: pickup!.lat, lng: pickup!.lng, address: label(pickup) },
          dropoff: { lat: dropoff!.lat, lng: dropoff!.lng, address: label(dropoff) },
          stops: stopPayload(),
        },
      }),
    enabled: step === "ride" && tripKind === "delivery" && Boolean(pickup && dropoff),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const deliveryCompanies = useMemo(
    () => deliveryOptionsQuery.data?.options ?? [],
    [deliveryOptionsQuery.data],
  );
  const selectedDelivery =
    deliveryCompanies.find((option) => option.fleetId === deliveryFleetId) ?? null;
  const selectedDeliveryVehicle =
    selectedDelivery?.availableVehicles.find((vehicle) => vehicle.vehicleClass === vehicleClass) ??
    null;
  useEffect(() => {
    if (tripKind !== "delivery" || !deliveryOptionsQuery.data) return;
    const company =
      deliveryCompanies.find((option) => option.fleetId === deliveryFleetId) ??
      deliveryCompanies[0];
    if (!company) {
      setDeliveryFleetId(null);
      return;
    }
    if (company.fleetId !== deliveryFleetId) setDeliveryFleetId(company.fleetId);
    if (!company.availableVehicles.some((vehicle) => vehicle.vehicleClass === vehicleClass)) {
      setVehicleClass(company.availableVehicles[0]!.vehicleClass as VehicleClass);
    }
  }, [tripKind, deliveryOptionsQuery.data, deliveryCompanies, deliveryFleetId, vehicleClass]);

  const promoFn = useServerFn(validatePromoCode);
  const applyingPromo = useMutation({
    mutationFn: async () => {
      const fare = chosen?.available ? chosen.total : 0;
      return promoFn({ data: { code: promoInput.trim().toUpperCase(), totalFare: fare } });
    },
    onSuccess: (result) => {
      setPromoError(null);
      if (!result.valid) {
        setAppliedPromo(null);
        setPromoStatus(result.state);
        setPromoError(result.message);
        return;
      }
      setPromoStatus("active");
      setAppliedPromo({
        code: result.code,
        name: result.name,
        discount_percent: result.discount_percent,
        discount_amount: result.discount_amount,
        total_before_discount: result.total_before_discount,
        total_fare: result.total_fare,
        promotionId: result.promotionId,
      });
    },
    onError: (err: Error) => {
      setAppliedPromo(null);
      setPromoStatus(null);
      setPromoError(err.message);
    },
  });

  // One tap: price the route on the server, keep that quote and start the
  // driver search. The customer never has to "lock" a fare by hand.
  const requesting = useMutation({
    mutationFn: async () => {
      const priced =
        tripKind === "delivery"
          ? await deliveryQuoteFn({
              data: {
                pickup: { lat: pickup!.lat, lng: pickup!.lng, address: label(pickup) },
                dropoff: { lat: dropoff!.lat, lng: dropoff!.lng, address: label(dropoff) },
                stops: stopPayload(),
                vehicleClass,
                deliveryFleetId: selectedDelivery!.fleetId,
                pickupNotes: pickupNotes.trim() ? pickupNotes.trim() : null,
                recipientName: recipientName.trim() || null,
                recipientPhone: recipientPhone.replace(/\s/g, ""),
              },
            })
          : await quoteFn({
              data: {
                pickup: { lat: pickup!.lat, lng: pickup!.lng, address: label(pickup) },
                dropoff: { lat: dropoff!.lat, lng: dropoff!.lng, address: label(dropoff) },
                stops: stopPayload(),
                vehicleClass,
                pickupNotes: pickupNotes.trim() ? pickupNotes.trim() : null,
                ...(appliedPromo?.code ? { promoCode: appliedPromo.code } : {}),
              },
            });
      return requestFn({
        data: {
          quoteId: priced.quote.id,
          paymentMethod,
          msisdn: paymentMethod === "stk_push" ? msisdn : null,
          idempotencyKey: crypto.randomUUID(),
        },
      });
    },
    onSuccess: (result) => {
      navigate({ to: "/rides/$rideId", params: { rideId: result.ride.id } });
    },
  });

  async function placePin(point: { lat: number; lng: number }) {
    const target = placing;
    const next: Point = { ...point };
    if (target === "pickup") setPickup(next);
    else setDropoff(next);
    try {
      const resolved = await resolvePoint(point);
      if (!resolved) return;
      const enriched: Point = { ...point, label: resolved.label, address: resolved.address };
      if (target === "pickup") setPickup(enriched);
      else setDropoff(enriched);
    } catch {
      // Coordinates remain the source of truth even if the label lookup fails.
    }
  }

  // Pickup defaults to where the phone says you are; you only type where to.
  const requestCurrentLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocating(false);
      setLocateError("This device can't share your location — drop the pickup pin on the map.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setPickup({ ...point, label: "Current location" });
        setLocating(false);
        try {
          const resolved = await resolvePoint(point);
          if (!resolved) return;
          setPickup({ ...point, label: resolved.label, address: resolved.address });
        } catch {
          // Coordinates stay authoritative even without a friendly name.
        }
      },
      () => {
        setLocating(false);
        setLocateError("We couldn't read your location — drop the pickup pin on the map instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [resolvePoint]);

  useEffect(() => {
    requestCurrentLocation();
  }, [requestCurrentLocation]);

  // Price every vehicle class as soon as both ends of the trip (and any stops)
  // are known.
  const stopsPriceKey = JSON.stringify(stops.map((stop) => [stop.lat, stop.lng]));
  useEffect(() => {
    if (!pickup || !dropoff) return;
    estimating.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, stops.length, stopsPriceKey]);

  // Live, anonymised supply around the pickup: the rider sees real cars, and
  // the hex-bounded server query keeps map-provider usage flat.
  const supply = useQuery({
    queryKey: ["nearby-drivers", pickup?.lat.toFixed(3), pickup?.lng.toFixed(3), vehicleClass],
    enabled: Boolean(pickup),
    refetchInterval: 20000,
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) return { drivers: [], radiusKm: 5 };
      return nearbyFn({ data: { lat: pickup!.lat, lng: pickup!.lng, vehicleClass } });
    },
  });
  const nearby = supply.data?.drivers ?? [];

  function choosePlace(point: Point) {
    if (searchTarget === "stop") {
      setStops((current) => [...current, point]);
    } else if (searchTarget === "pickup") {
      setPickup(point);
      setLocateError(null);
    } else {
      setDropoff(point);
      const next = [point, ...recents.filter((item) => label(item) !== label(point))].slice(0, 5);
      setRecents(next);
      writeRecents(next);
      // Once we know where you're going, go straight to choosing the ride.
      if (pickup) setStep("ride");
    }
    setSearchOpen(false);
  }

  function moveStop(index: number, delta: number) {
    setStops((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
  }

  function openSearch(target: "pickup" | "dropoff" | "stop") {
    setSearchTarget(target);
    if (target !== "stop") setPlacing(target);
    setSearchOpen(true);
    window.setTimeout(() => searchInput.current?.focus(), 60);
  }

  const readyForRide = Boolean(pickup && dropoff);

  return (
    <AppShell
      title={step === "ride" ? "Choose your ride" : "Book a taxi"}
      hideNav={searchOpen || step === "ride"}
    >
      <div className="h-64 w-full border-b border-border">
        <MapPanel
          pickup={pickup}
          dropoff={dropoff}
          nearbyDrivers={nearby}
          polyline={estimating.data?.polyline ?? null}
          placing={placing}
          onPlace={placePin}
          className="h-64 w-full"
        />
      </div>

      {step === "where" ? (
        <div className="mx-auto max-w-md px-4 py-4 pb-8">
          {/* Pickup is your current location by default — you only say where to. */}
          <div className="surface-card flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Pickup
              </p>
              <p className="truncate text-sm font-medium text-foreground">
                {locating ? "Finding your location…" : label(pickup)}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <button
                onClick={requestCurrentLocation}
                className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground"
              >
                Use my location
              </button>
              <button
                onClick={() => openSearch("pickup")}
                className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground"
              >
                Search pickup
              </button>
              <button
                onClick={() => setPlacing(placing === "pickup" ? "dropoff" : "pickup")}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  placing === "pickup"
                    ? "bg-primary text-primary-foreground"
                    : "border border-input text-muted-foreground"
                }`}
              >
                {placing === "pickup" ? "Tap map…" : "Change"}
              </button>
            </div>
          </div>
          {locateError && <p className="mt-2 text-xs text-destructive">{locateError}</p>}

          {/* Where to is the whole job: one big tap opens a full-screen search. */}
          <button
            onClick={() => openSearch("dropoff")}
            className="mt-4 w-full rounded-2xl border-2 border-border bg-card px-4 py-4 text-left"
          >
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Destination
            </span>
            <span className="mt-0.5 block truncate font-display text-2xl font-bold leading-tight text-foreground">
              {dropoff ? label(dropoff) : "Where to?"}
            </span>
          </button>

          {/* Some places have no name to search for — drop the pin on the map instead. */}
          <button
            onClick={() => {
              setSearchOpen(false);
              setPlacing("dropoff");
            }}
            className={`mt-2 w-full rounded-full px-3 py-2 text-xs font-medium ${
              placing === "dropoff"
                ? "bg-primary text-primary-foreground"
                : "border border-input text-muted-foreground"
            }`}
          >
            {placing === "dropoff"
              ? "Tap the map to set your destination"
              : "Pick the destination on the map"}
          </button>

          {/* Stops along the way, in the order the customer arranges them. */}
          {dropoff ? (
            <div className="mt-4 rounded-2xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">Stops along the way</p>
                <button
                  onClick={() => openSearch("stop")}
                  disabled={stops.length >= 4}
                  className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
                >
                  Add a stop
                </button>
              </div>
              {stops.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Need to pick someone up or drop something off? Add a stop and order them as you
                  like.
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {stops.map((stop, index) => (
                    <li
                      key={`${label(stop)}-${index}`}
                      className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {label(stop)}
                      </span>
                      <button
                        onClick={() => moveStop(index, -1)}
                        disabled={index === 0}
                        aria-label="Move stop earlier"
                        className="rounded-full border border-input px-2 py-1 text-xs disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveStop(index, 1)}
                        disabled={index === stops.length - 1}
                        aria-label="Move stop later"
                        className="rounded-full border border-input px-2 py-1 text-xs disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => setStops((current) => current.filter((_, i) => i !== index))}
                        aria-label="Remove stop"
                        className="rounded-full border border-input px-2 py-1 text-xs text-destructive"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}

          {/* Recent and saved destinations, straight from the customer's own data. */}
          {!dropoff && (recents.length > 0 || (saved.data?.length ?? 0) > 0) ? (
            <div className="mt-3 space-y-1.5">
              {(saved.data ?? []).map((place) => (
                <button
                  key={place.id}
                  onClick={() =>
                    choosePlace({
                      lat: Number(place.lat),
                      lng: Number(place.lng),
                      label: place.label,
                      address: place.address,
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
                >
                  <span className="text-base">★</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {place.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {place.address ?? "Saved place"}
                    </span>
                  </span>
                </button>
              ))}
              {recents.map((place, index) => (
                <button
                  key={`${label(place)}-${index}`}
                  onClick={() => choosePlace(place)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
                >
                  <span className="text-base">↻</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {label(place)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">Recent</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {readyForRide ? (
            <button
              onClick={() => setStep("ride")}
              className="mt-5 w-full rounded-full bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground"
            >
              {estimating.isPending
                ? "Checking prices…"
                : `Choose your ride${estimating.data ? ` · ${estimating.data.distance_km.toFixed(1)} km` : ""}`}
            </button>
          ) : (
            <p className="mt-4 rounded-2xl border border-border bg-secondary px-3 py-3 text-sm text-secondary-foreground">
              Tell us where you're going and we'll show every ride option with its price.
            </p>
          )}
        </div>
      ) : (
        /* Step two: pick the ride and how you'll pay. The bottom dock is hidden
           so the request button is the only thing left to tap. */
        <div className="mx-auto max-w-md px-4 py-4 pb-40">
          <button
            onClick={() => setStep("where")}
            className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground"
          >
            ← Change trip
          </button>

          <dl className="mt-3 space-y-1 rounded-2xl border border-border bg-card p-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Pickup</dt>
              <dd className="truncate text-right text-foreground">{label(pickup)}</dd>
            </div>
            {stops.map((stop, index) => (
              <div key={`summary-${index}`} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Stop {index + 1}</dt>
                <dd className="truncate text-right text-foreground">{label(stop)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Destination</dt>
              <dd className="truncate text-right text-foreground">{label(dropoff)}</dd>
            </div>
            {estimating.data ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Trip</dt>
                <dd className="text-right text-foreground">
                  {estimating.data.distance_km.toFixed(1)} km ·{" "}
                  {Math.round(estimating.data.duration_minutes)} min
                </dd>
              </div>
            ) : null}
          </dl>

          <h2 className="mt-5 font-display text-lg font-bold text-foreground">
            {tripKind === "delivery" ? "Choose your delivery" : "Choose your ride"}
          </h2>

          {/* Same drivers, two jobs: carry a person or send a parcel. */}
          <div className="mt-2 flex gap-2">
            {(
              [
                { key: "ride", label: "Ride" },
                { key: "delivery", label: "Twende Delivery" },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                onClick={() => {
                  setTripKind(option.key);
                  setDeliveryFleetId(null);
                  if (option.key === "delivery") {
                    setAppliedPromo(null);
                    setPromoError(null);
                  }
                  setVehicleClass(option.key === "delivery" ? "boda" : "go");
                }}
                className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                  tripKind === option.key
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-secondary text-secondary-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {tripKind === "delivery" ? (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Compare each approved company's route price, then choose a nearby vehicle type. The
                request only goes to that company's available drivers.
              </p>
              {deliveryOptionsQuery.isPending ? (
                <p className="rounded-xl bg-secondary p-3 text-sm text-muted-foreground">
                  Finding approved delivery companies and nearby vehicles…
                </p>
              ) : null}
              {deliveryOptionsQuery.isError ? (
                <p className="text-sm text-destructive">
                  {(deliveryOptionsQuery.error as Error).message}
                </p>
              ) : null}
              {!deliveryOptionsQuery.isPending && deliveryCompanies.length === 0 ? (
                <p className="rounded-xl border border-border bg-secondary p-3 text-sm text-muted-foreground">
                  No approved delivery company has an available vehicle near this pickup right now.
                  Try again in a moment or choose a cab.
                </p>
              ) : null}
              {deliveryCompanies.map((company) => {
                const selected = company.fleetId === deliveryFleetId;
                return (
                  <section
                    key={company.fleetId}
                    className={`rounded-2xl border-2 p-3 ${selected ? "border-primary bg-accent/40" : "border-border bg-card"}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryFleetId(company.fleetId);
                        setVehicleClass(company.availableVehicles[0]!.vehicleClass as VehicleClass);
                      }}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <span>
                        <span className="block text-sm font-bold text-foreground">
                          {company.businessName}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {company.availableVehicles.length} nearby vehicle
                          {company.availableVehicles.length === 1 ? "" : "s"} ·{" "}
                          {company.distanceKm.toFixed(1)} km route
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-display text-lg font-bold text-foreground">
                          KES {company.feeEstimate.toFixed(0)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          estimated delivery fee
                        </span>
                      </span>
                    </button>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Base {company.baseFee.toFixed(0)} + distance {company.distanceFee.toFixed(0)}{" "}
                      + time {company.timeFee.toFixed(0)} KES; minimum fee applies where higher.
                    </p>
                    <div className="mt-2 space-y-2">
                      {company.availableVehicles.map((vehicle, index) => (
                        <button
                          key={vehicle.id}
                          type="button"
                          onClick={() => {
                            setDeliveryFleetId(company.fleetId);
                            setVehicleClass(vehicle.vehicleClass as VehicleClass);
                          }}
                          className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left ${selected && vehicleClass === vehicle.vehicleClass ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                        >
                          {vehicle.photoUrl ? (
                            <img
                              src={vehicle.photoUrl}
                              alt={`${vehicle.make ?? "Delivery"} ${vehicle.model ?? "vehicle"}`}
                              className="h-12 w-16 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <span className="grid h-12 w-16 shrink-0 place-items-center rounded-lg bg-secondary text-[10px] text-muted-foreground">
                              Vehicle
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-foreground">
                              {[vehicle.make, vehicle.model, vehicle.colour]
                                .filter(Boolean)
                                .join(" ") ||
                                `${vehicle.vehicleClass.replace("_", " ")} delivery vehicle`}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">
                              {vehicle.vehicleClass.replace("_", " ").toUpperCase()} · about{" "}
                              {vehicle.etaMinutes} min away · {vehicle.distanceKm.toFixed(1)} km
                            </span>
                          </span>
                          <span className="text-[10px] font-semibold text-primary">
                            {selected && vehicleClass === vehicle.vehicleClass
                              ? "Selected"
                              : index === 0
                                ? "Choose"
                                : "Select"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {(["boda", "e_boda", "go", "plus", "comfort", "xl"] as const).map((option) => {
                const naming = CLASS_LABELS[option];
                const priced = estimates.find((item) => item.vehicleClass === option);
                const selected = vehicleClass === option;
                const unavailable = priced ? !priced.available : false;
                return (
                  <button
                    key={option}
                    disabled={unavailable}
                    onClick={() => setVehicleClass(option)}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${selected ? "border-primary bg-accent" : "border-border bg-card"} disabled:opacity-60`}
                  >
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                      {option === "boda" || option === "e_boda" ? <Bike className="h-5 w-5" /> : <Car className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">
                        {naming.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {unavailable ? "Not available on this route" : naming.hint}
                      </span>
                      {priced && priced.available && priced.discount_percent > 0 ? (
                        <span className="mt-1 inline-flex rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-gold-foreground">
                          {priced.discount_label ?? `${priced.discount_percent}% off`}
                        </span>
                      ) : null}
                      {priced && priced.available && priced.approach_fee > 0 ? (
                        <span className="mt-1 block text-[11px] font-medium text-primary">
                          Nearest car is {priced.approach_distance_km.toFixed(1)} km away · +KES{" "}
                          {priced.approach_fee} pickup fee
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      {priced && priced.available ? (
                        <>
                          <span className="font-display text-base font-bold text-foreground">
                            KES {priced.total.toFixed(0)}
                          </span>
                        </>
                      ) : estimating.isPending ? (
                        <span className="text-xs text-muted-foreground">…</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {estimating.isError ? (
            <p className="mt-2 text-xs text-destructive">{(estimating.error as Error).message}</p>
          ) : null}
          {chosen && chosen.available && chosen.approach_fee > 0 ? (
            <div className="mt-3 rounded-2xl border border-primary/30 bg-accent px-3.5 py-2.5 text-xs text-foreground">
              <p className="font-semibold">The nearest car is far from you</p>
              <p className="mt-0.5 text-muted-foreground">
                It's {chosen.approach_distance_km.toFixed(1)} km away and must drive to you first, so a
                pickup fee of KES {chosen.approach_fee} is included in the price.
              </p>
            </div>
          ) : null}

          {/* One compact line showing how you'll pay, tapped open to change. */}
          <label className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3.5 py-2.5">
            <span className="text-xs font-medium text-muted-foreground">Paying with</span>
            <select
              value={paymentMethod}
              onChange={(event) => {
                setPaymentTouched(true);
                setPaymentMethod(event.target.value as "stk_push" | "cash");
              }}
              className="rounded-full border border-input bg-background px-3 py-1.5 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="stk_push">M-PESA</option>
              <option value="cash">Cash</option>
            </select>
          </label>

          {paymentMethod === "stk_push" && (
            <label className="mt-3 block">
              <span className="text-xs font-medium text-muted-foreground">M-PESA number</span>
              <input
                value={msisdn}
                onChange={(event) => {
                  setMsisdnTouched(true);
                  setMsisdn(event.target.value);
                }}
                inputMode="tel"
                placeholder="07XX XXX XXX"
                className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              {me?.profile?.phone && msisdn === me.profile.phone ? (
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Using the number on your account — change it if someone else is paying.
                </span>
              ) : null}
            </label>
          )}

          <p className="mt-2 rounded-2xl bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary-foreground">
            {paymentMethod === "stk_push"
              ? "Paying by M-PESA settles the whole trip — nothing more to pay the driver."
              : "Cash means you settle with the driver at the end of the trip."}
          </p>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-muted-foreground">
              Pickup notes (optional)
            </span>
            <input
              value={pickupNotes}
              onChange={(event) => setPickupNotes(event.target.value)}
              placeholder="Gate colour, landmark, floor…"
              className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {tripKind === "delivery" ? (
            <div className="mt-4 grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Who is receiving the package? We text them when it's picked up and delivered.
              </span>
              <input
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
                placeholder="Receiver's name"
                className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                value={recipientPhone}
                onChange={(event) => setRecipientPhone(event.target.value)}
                inputMode="tel"
                placeholder="Receiver's phone, e.g. 0712 345 678"
                className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          ) : null}

          {/* The coupon box stays out of the way until it's wanted. */}
          {tripKind === "ride" ? (
            <div className="mt-4">
              {!promoOpen && !appliedPromo ? (
                <button
                  onClick={() => setPromoOpen(true)}
                  className="w-full rounded-2xl border border-dashed border-input px-3 py-2.5 text-sm font-semibold text-foreground"
                >
                  Have a Promo Coupon?
                </button>
              ) : null}
              {promoOpen && !appliedPromo ? (
                <>
                  <span className="text-xs font-medium text-muted-foreground">Promo code</span>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={promoInput}
                      onChange={(e) => {
                        setPromoInput(e.target.value);
                        setPromoError(null);
                      }}
                      placeholder="Enter a code"
                      className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm uppercase"
                    />
                    <button
                      onClick={() => applyingPromo.mutate()}
                      disabled={
                        applyingPromo.isPending ||
                        promoInput.trim().length < 2 ||
                        !chosen?.available
                      }
                      className="rounded-xl border border-input bg-secondary px-4 py-2.5 text-sm font-semibold"
                    >
                      {applyingPromo.isPending ? "Checking…" : "Apply"}
                    </button>
                  </div>
                </>
              ) : null}
              {appliedPromo ? (
                <div className="mt-2 rounded-xl bg-success/10 px-3 py-2.5 text-xs text-success">
                  <p className="font-semibold">
                    {appliedPromo.code} applied — {appliedPromo.discount_percent}% off
                  </p>
                  <p>
                    You save KES {appliedPromo.discount_amount.toFixed(2)} — new fare KES{" "}
                    {appliedPromo.total_fare.toFixed(2)}.
                  </p>
                  <button
                    onClick={() => {
                      setAppliedPromo(null);
                      setPromoInput("");
                      setPromoError(null);
                      setPromoStatus(null);
                    }}
                    className="mt-1 underline"
                  >
                    Remove code
                  </button>
                </div>
              ) : null}
              {promoError ? <p className="mt-2 text-xs text-destructive">{promoError}</p> : null}
            </div>
          ) : null}

          {requesting.isError && (
            <p className="mt-3 text-sm text-destructive">{(requesting.error as Error).message}</p>
          )}

          {/* Floating request button: the only action at this step. */}
          <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/90 to-transparent" />
            <button
              disabled={
                requesting.isPending ||
                (paymentMethod === "stk_push" && msisdn.trim().length < 9) ||
                (tripKind === "delivery" && (!selectedDelivery || !selectedDeliveryVehicle))
              }
              onClick={() => requesting.mutate()}
              className="relative mx-auto block w-full max-w-md rounded-full bg-primary px-4 py-4 text-sm font-bold text-primary-foreground shadow-[0_16px_40px_-12px_rgba(0,0,0,0.55)] disabled:opacity-60"
            >
              {requesting.isPending
                ? tripKind === "delivery"
                  ? "Finding your delivery driver…"
                  : "Finding your driver…"
                : tripKind === "delivery"
                  ? `Book ${selectedDelivery?.businessName ?? "delivery"}${selectedDelivery ? ` · KES ${selectedDelivery.feeEstimate.toFixed(0)}` : ""}`
                  : `Find a driver · ${CLASS_LABELS[vehicleClass].name}${chosen && chosen.available ? ` · KES ${chosen.total.toFixed(0)}` : ""}`}
            </button>
          </div>
        </div>
      )}

      {searchOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <button
              onClick={() => setSearchOpen(false)}
              className="rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              Close
            </button>
            <p className="font-display text-lg font-bold text-foreground">
              {searchTarget === "stop"
                ? "Add a stop"
                : searchTarget === "pickup"
                  ? "Choose your pickup"
                  : "Where to?"}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <PlaceSearch
              prominent
              inputRef={searchInput}
              placeholder={
                searchTarget === "stop"
                  ? "Search for a stop"
                  : searchTarget === "pickup"
                    ? "Search for your pickup"
                    : "Type your destination"
              }
              near={pickup ?? dropoff}
              value={null}
              onSuggestionsChange={setSuggestionsOpen}
              onPick={(place) =>
                choosePlace({
                  lat: place.lat,
                  lng: place.lng,
                  label: place.label,
                  address: place.address,
                })
              }
            />
            {!suggestionsOpen
              ? (saved.data ?? []).map((place) => (
                  <button
                    key={place.id}
                    onClick={() =>
                      choosePlace({
                        lat: Number(place.lat),
                        lng: Number(place.lng),
                        label: place.label,
                        address: place.address,
                      })
                    }
                    className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
                  >
                    <span>★</span>
                    <span className="truncate text-sm font-semibold text-foreground">
                      {place.label}
                    </span>
                  </button>
                ))
              : null}
            {!suggestionsOpen
              ? recents.map((place, index) => (
                  <button
                    key={`recent-${index}`}
                    onClick={() => choosePlace(place)}
                    className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left"
                  >
                    <span>↻</span>
                    <span className="truncate text-sm font-semibold text-foreground">
                      {label(place)}
                    </span>
                  </button>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

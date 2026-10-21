import { PayHireWithWallet } from "@/components/CustomerWalletCard";
import { Link, useNavigate } from "@tanstack/react-router";
import { PaymentProgressCard, type PayState } from "@/components/PaymentProgressCard";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { CorporateHireTerms, type CorporateTerms } from "@/components/CorporateHireTerms";
import { AppShell } from "@/components/AppShell";
import { PlaceSearch } from "@/components/PlaceSearch";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { ReceiptDownload } from "@/components/ReceiptDownload";
import {
  estimateHireTotal,
  getMyHireDocuments,
  listHireVehicles,
  listMyHireQuotes,
  payHireBooking,
  respondToHireOffer,
  saveMyHireDocument,
  submitHireQuote,
} from "@/lib/hire.functions";

export const Route = createFileRoute("/_authenticated/hire")({
  head: () => ({
    meta: [
      { title: "Hire a car in Meru | Twende Meru Rides" },
      {
        name: "description",
        content:
          "Browse inspected hire cars in Meru, compare features and availability, choose pickup and return times, see your total, then send your booking details.",
      },
      { property: "og:title", content: "Hire a car in Meru | Twende Meru Rides" },
      {
        property: "og:description",
        content:
          "Self-drive hire with real listed cars and live availability, or a full-service quotation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HirePage,
});

const STATUS_COPY: Record<string, string> = {
  submitted: "Waiting for offers",
  quoted: "Offer waiting for you",
  confirmed: "Confirmed",
  declined: "Not available",
};

const DAY = 86_400_000;

interface Place {
  label: string;
  lat: number | null;
  lng: number | null;
}

type Vehicle = Awaited<ReturnType<typeof listHireVehicles>>[number];

function overlapsRange(vehicle: Vehicle, start: Date, end: Date) {
  return vehicle.bookings.some(
    (booking) =>
      new Date(booking.start).getTime() < end.getTime() &&
      new Date(booking.end).getTime() > start.getTime(),
  );
}

function nextAvailableStart(vehicle: Vehicle, days: number, from = new Date()) {
  let cursor = from.getTime();
  const duration = Math.max(1, days) * DAY;
  const bookings = [...vehicle.bookings].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  for (const booking of bookings) {
    const bookingStart = new Date(booking.start).getTime();
    const bookingEnd = new Date(booking.end).getTime();
    if (bookingEnd <= cursor) continue;
    if (bookingStart < cursor + duration) cursor = bookingEnd;
  }
  return new Date(cursor);
}

function parseFeatures(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);
}

function localDateTimeInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function calendarDay(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAtClock(date: Date, clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return localDateTimeInput(
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour || 0, minute || 0),
  );
}

function bookingTouchesDay(date: Date, bookings: Vehicle["bookings"]) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + DAY;
  return bookings.some(
    (booking) => new Date(booking.start).getTime() < end && new Date(booking.end).getTime() > start,
  );
}

function clockFrom(value: string, fallback: string) {
  return value.includes("T") ? value.slice(11, 16) : fallback;
}

function defaultPickupClock(date: Date) {
  const now = new Date();
  const target = new Date(now.getTime() + 5 * 60_000);
  if (dayKey(date) !== dayKey(now)) return "10:00";
  if (dayKey(target) === dayKey(date)) {
    return `${String(target.getHours()).padStart(2, "0")}:${String(target.getMinutes()).padStart(2, "0")}`;
  }
  return "23:59";
}

function availabilityDateLabel(value: string | Date) {
  const date = new Date(value);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const formatted = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return sameDay ? `Available today, ${formatted}` : `Available on ${formatted}`;
}

function listedDayTotal(vehicle: Vehicle, driveMode: "self_drive" | "chauffeured") {
  return estimateHireTotal({
    vehicleClass: vehicle.vehicle_class,
    driveMode,
    days: 1,
    stops: 0,
    dailyRate: Number(vehicle.day_rate),
    chauffeurDailyRate: Number(vehicle.chauffeur_daily_rate),
  });
}

function insuranceLabel(value: string | null) {
  switch (value) {
    case "comprehensive":
      return "Comprehensive";
    case "third_party_fire_theft":
      return "Third party, fire and theft";
    case "third_party_only":
      return "Third party only";
    case "other":
      return "Other coverage";
    default:
      return "Not specified";
  }
}

function HirePage() {
  const queryClient = useQueryClient();
  const submitFn = useServerFn(submitHireQuote);
  const listFn = useServerFn(listMyHireQuotes);
  const savedDocsFn = useServerFn(getMyHireDocuments);
  const saveDocFn = useServerFn(saveMyHireDocument);
  const vehiclesFn = useServerFn(listHireVehicles);
  const respondFn = useServerFn(respondToHireOffer);
  const payFn = useServerFn(payHireBooking);
  const [accountId, setAccountId] = useState<string | null>(null);

  const quotes = useQuery({
    queryKey: ["hire-quotes"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
  });
  const savedDocuments = useQuery({
    queryKey: ["my-hire-documents", accountId],
    queryFn: () => savedDocsFn(),
    enabled: Boolean(accountId),
  });
  const vehicles = useQuery({
    queryKey: ["hire-vehicles"],
    queryFn: () => vehiclesFn(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const [tab, setTab] = useState<"self_drive" | "chauffeured">("self_drive");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [bookingStep, setBookingStep] = useState<"browse" | "details">("browse");

  // Filters
  const [fSeats, setFSeats] = useState("");
  const [fMake, setFMake] = useState("");
  const [fModel, setFModel] = useState("");
  const [fMaxPrice, setFMaxPrice] = useState("");

  // Hirer details and needs
  const [hirerType, setHirerType] = useState<"individual" | "company">("individual");
  const [companyPayNow, setCompanyPayNow] = useState(true);
  const [payCard, setPayCard] = useState<{ quoteId: string; amount?: number | null } | null>(null);
  const navigate = useNavigate();
  const usePayLater = hirerType === "company" && !companyPayNow;
  const [renterName, setRenterName] = useState("");
  const [rememberDocs, setRememberDocs] = useState(true);
  const [renterIdNumber, setRenterIdNumber] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [startAt, setStartAt] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [peopleText, setPeopleText] = useState("1");
  const [pickup, setPickup] = useState<Place | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [notes, setNotes] = useState("");
  const [idPath, setIdPath] = useState<string | null>(null);
  const [licensePath, setLicensePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [corporateTerms, setCorporateTerms] = useState<CorporateTerms | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!idPath && savedDocuments.data?.idDocumentPath) {
      setIdPath(savedDocuments.data.idDocumentPath);
    }
    if (!licensePath && savedDocuments.data?.licenseDocumentPath) {
      setLicensePath(savedDocuments.data.licenseDocumentPath);
    }
  }, [idPath, licensePath, savedDocuments.data]);

  useEffect(() => {
    let live = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (live) setAccountId(session?.user.id ?? null);
    });
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      if (live) setAccountId(data.user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone, id_number, company_name")
        .eq("id", data.user.id)
        .maybeSingle();
      if (live && profile) {
        if (profile.id_number) setRenterIdNumber((current) => current || profile.id_number || "");
        if (profile.company_name) setOrganisation((current) => current || profile.company_name || "");
        if (profile.full_name) setRenterName((current) => current || profile.full_name || "");
        if (profile.phone) setPaymentPhone((current) => current || profile.phone || "");
      }
    });
    return () => {
      live = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setIdPath(null);
    setLicensePath(null);
  }, [accountId]);

  const passengers = Math.min(60, Math.max(1, Number(peopleText) || 1));
  const start = startAt ? new Date(startAt) : null;
  const endDate = returnAt ? new Date(returnAt) : null;
  const days =
    start && endDate && endDate.getTime() > start.getTime()
      ? Math.ceil((endDate.getTime() - start.getTime()) / DAY)
      : 0;
  const scheduleValid = Boolean(
    start &&
    endDate &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(endDate.getTime()) &&
    start.getTime() >= Date.now() &&
    endDate.getTime() > start.getTime() &&
    days >= 1 &&
    days <= 90,
  );

  const all = useMemo(() => vehicles.data ?? [], [vehicles.data]);
  const makes = useMemo(
    () => [...new Set(all.map((v) => v.make).filter(Boolean))] as string[],
    [all],
  );
  const filtered = all.filter((v) => {
    if (!(v.hire_mode === "both" || v.hire_mode === tab || !v.hire_mode)) return false;
    if (fSeats && (v.seats ?? 0) < Number(fSeats)) return false;
    if (fMake && v.make !== fMake) return false;
    if (fModel && !(v.model ?? "").toLowerCase().includes(fModel.toLowerCase())) return false;
    if (fMaxPrice && listedDayTotal(v, tab) > Number(fMaxPrice)) return false;
    return true;
  });

  const listed = [...filtered].sort((a, b) => {
    const aBusy = Boolean(scheduleValid && start && endDate && overlapsRange(a, start, endDate));
    const bBusy = Boolean(scheduleValid && start && endDate && overlapsRange(b, start, endDate));
    if (scheduleValid && aBusy !== bBusy) return aBusy ? 1 : -1;
    const durationDays = days || 1;
    const refA = scheduleValid && aBusy && endDate ? endDate : new Date();
    const refB = scheduleValid && bBusy && endDate ? endDate : new Date();
    const nextA = nextAvailableStart(a, durationDays, refA).getTime();
    const nextB = nextAvailableStart(b, durationDays, refB).getTime();
    return nextA - nextB || listedDayTotal(a, tab) - listedDayTotal(b, tab);
  });

  const chosen = all.find((v) => v.id === vehicleId) ?? null;
  const opened = all.find((v) => v.id === openId) ?? null;
  const clash = Boolean(
    chosen && scheduleValid && start && endDate && overlapsRange(chosen, start, endDate),
  );
  const openClash = Boolean(
    opened && scheduleValid && start && endDate && overlapsRange(opened, start, endDate),
  );
  const detailsReady = scheduleValid && bookingStep === "details" && Boolean(chosen);
  const estimatedTotal =
    scheduleValid && chosen
      ? estimateHireTotal({
          vehicleClass: chosen.vehicle_class,
          driveMode: tab,
          days,
          stops: stops.length,
          dailyRate: Number(chosen.day_rate),
          chauffeurDailyRate: Number(chosen.chauffeur_daily_rate),
        })
      : null;
  const openedTotal =
    scheduleValid && opened
      ? estimateHireTotal({
          vehicleClass: opened.vehicle_class,
          driveMode: tab,
          days,
          stops: 0,
          dailyRate: Number(opened.day_rate),
          chauffeurDailyRate: Number(opened.chauffeur_daily_rate),
        })
      : null;

  function updatePickupTime(value: string) {
    setStartAt(value);
    if (returnAt && new Date(returnAt).getTime() <= new Date(value).getTime()) setReturnAt("");
  }

  function capturePickupLocation() {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError(
        "Location capture is not supported by this browser. Search for a place instead.",
      );
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = Number(coords.latitude.toFixed(6));
        const lng = Number(coords.longitude.toFixed(6));
        setPickup({ label: `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`, lat, lng });
        setLocationBusy(false);
      },
      (error) => {
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Search for a place or enable location access."
            : "Could not capture your location. Try again or search for a place.",
        );
        setLocationBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  async function upload(kind: "id" | "license", file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Each document must be 10 MB or smaller.");
      return;
    }
    if (file.type && !file.type.startsWith("image/") && file.type !== "application/pdf") {
      setMessage("Upload a photo or PDF of the document.");
      return;
    }
    setUploading(kind);
    setMessage(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setUploading(null);
      return;
    }
    const path = `${auth.user.id}/${kind}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
    const { error } = await supabase.storage
      .from("hire-documents")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setUploading(null);
      setMessage(error.message);
      return;
    }
    try {
      await saveDocFn({ data: { kind, filePath: path, remember: rememberDocs } });
      if (kind === "id") setIdPath(path);
      else setLicensePath(path);
      void queryClient.invalidateQueries({ queryKey: ["my-hire-documents"] });
      setMessage(
        rememberDocs
          ? `${kind === "id" ? "ID" : "Driving licence"} saved to your account for future hires.`
          : `${kind === "id" ? "ID" : "Driving licence"} attached to this booking only.`,
      );
    } catch (error) {
      await supabase.storage.from("hire-documents").remove([path]);
      setMessage((error as Error).message);
    } finally {
      setUploading(null);
    }
  }

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          kind: hirerType === "company" ? "corporate" : "car_hire",
          vehicleId,
          organisation: hirerType === "company" ? organisation.trim() || undefined : undefined,
          vehicleClass: chosen!.vehicle_class,
          driveMode: tab,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(returnAt).toISOString(),
          passengers,
          pickupLabel: pickup!.label,
          pickupLat: pickup!.lat,
          pickupLng: pickup!.lng,
          stops: stops.map((s) => ({ label: s.label, lat: s.lat, lng: s.lng })),
          notes: notes.trim() || undefined,
          hirerType,
          renterName: renterName.trim() || undefined,
          renterIdNumber: renterIdNumber.trim() || undefined,
          contactPhone: paymentPhone.trim() || undefined,
          idDocumentPath: idPath ?? undefined,
          licenseDocumentPath: licensePath ?? undefined,
          rulesAccepted,
          corporate: usePayLater && corporateTerms ? corporateTerms : undefined,
        },
      }),
    onSuccess: (row) => {
      // Remember ID and company so repeat bookings are pre-filled.
      if (accountId && rememberDocs) {
        void supabase
          .from("profiles")
          .update({
            id_number: renterIdNumber.trim() || null,
            ...(hirerType === "company" && organisation.trim() ? { company_name: organisation.trim() } : {}),
          })
          .eq("id", accountId);
      }
      setMessage(
        usePayLater && corporateTerms
          ? `Booking ${row.reference} confirmed. Agreement signed; please pay by ${corporateTerms.payLaterMethod.replace("_", " ")} on ${corporateTerms.payLaterDueDate}.`
          : row.payment
          ? row.payment.accepted
            ? `Request ${row.reference} saved. Approve the M-Pesa prompt for KES ${Number(row.payment.amount).toLocaleString("en-KE")}; the owner sees it after the required payment clears.`
            : `Request ${row.reference} saved, but payment did not start: ${row.payment.message}. Retry from Your requests.`
          : `Request ${row.reference} sent. Estimate KES ${Number(row.estimated_total).toLocaleString("en-KE")} — a provider will respond.`,
      );
      if (row.payment?.accepted) setPayCard({ quoteId: row.id, amount: Number(row.payment.amount) });
      setStops([]);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

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

  const missing: string[] = [];
  if (!vehicleId) missing.push("choose a vehicle");
  if (!scheduleValid) missing.push("choose a future pickup and return time within 90 days");
  if (!pickup) missing.push("set where the car is brought");
  if (!renterName.trim()) missing.push("enter your name");
  if (chosen && !usePayLater && !paymentPhone.trim())
    missing.push("enter your M-Pesa phone number");
  if (hirerType === "company" && !organisation.trim()) missing.push("enter the company name");
  if (usePayLater && !corporateTerms)
    missing.push("verify the business email, pick a payment date and sign the agreement");
  if (!idPath && !savedDocuments.isPending) missing.push("upload your ID");
  if (tab === "self_drive" && !licensePath && !savedDocuments.isPending)
    missing.push("upload your driving licence");
  if (chosen && !rulesAccepted) missing.push("accept the owner's rules");
  if (clash) missing.push("choose available pickup and return times");
  const canSubmit = missing.length === 0 && !submit.isPending && !savedDocuments.isPending;

  return (
    <AppShell title="Hire a car">
      <div className="space-y-4 pb-24">
        <p className="mx-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
          Payment safety: pay for bookings and instalments only through Twende Meru Rides. Never
          send money directly to a driver or owner; report any pressure to pay outside the system to
          help prevent extortion and fraud.
        </p>
        <div className="flex gap-2">
          {(
            [
              { key: "self_drive", label: "Drive it myself" },
              { key: "chauffeured", label: "Chauffeured" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              onClick={() => {
                // Switching mode only re-prices: keep the car, dates and details.
                setTab(o.key);
                if (chosen && chosen.hire_mode && chosen.hire_mode !== "both" && chosen.hire_mode !== o.key) {
                  setVehicleId(null);
                  setBookingStep("browse");
                }
              }}
              className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                tab === o.key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-secondary text-secondary-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {tab === "chauffeured" ? (
          <p className="mx-4 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
            Chauffeured hire covers the car and chauffeur for each booked day. Fuel is not included:
            the customer covers fuel for the agreed route/distance, either arranged for that
            distance or purchased as needed while travelling.
          </p>
        ) : null}

        {bookingStep === "browse" ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-lg font-bold text-foreground">
              Available cars for hire{vehicles.isSuccess ? ` · ${listed.length}` : ""}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Browse the collection first. Tap any car to view its photo gallery, features and
              unavailable dates, then choose pickup and return times. You will see the total before
              entering your details.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <input
                value={fSeats}
                onChange={(e) => setFSeats(e.target.value)}
                inputMode="numeric"
                placeholder="Min seats"
                className="input-base"
              />
              <select
                value={fMake}
                onChange={(e) => setFMake(e.target.value)}
                className="input-base"
              >
                <option value="">Any make</option>
                {makes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={fModel}
                onChange={(e) => setFModel(e.target.value)}
                placeholder="Model"
                className="input-base"
              />
              <input
                value={fMaxPrice}
                onChange={(e) => setFMaxPrice(e.target.value)}
                inputMode="numeric"
                placeholder="Max KES/day"
                className="input-base"
              />
            </div>

            {vehicles.isPending ? (
              <p className="mt-3 text-xs text-muted-foreground">Loading cars…</p>
            ) : null}
            {!vehicles.isPending && listed.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {fSeats || fMake || fModel || fMaxPrice
                  ? "No cars match these filters. Clear a filter to see more listings."
                  : "No hire cars are currently published. Operations-approved and published cars appear here automatically; this list refreshes every 30 seconds."}
              </p>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
              {listed.map((v) => {
                const busy = Boolean(
                  scheduleValid && start && endDate && overlapsRange(v, start, endDate),
                );
                const availabilityFrom = nextAvailableStart(
                  v,
                  scheduleValid && busy ? days : scheduleValid ? days : 1,
                  scheduleValid && busy && endDate ? endDate : new Date(),
                );
                const availabilityLabel = scheduleValid
                  ? busy
                    ? availabilityDateLabel(availabilityFrom)
                    : "Available for your dates"
                  : availabilityDateLabel(availabilityFrom);
                const features = parseFeatures(v.hire_features);
                return (
                  <article
                    key={v.id}
                    className={`overflow-hidden rounded-2xl border-2 bg-card ${
                      vehicleId === v.id ? "border-primary" : "border-border"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setOpenId(v.id);
                        setPhotoIndex(0);
                      }}
                      className="block w-full text-left"
                    >
                      {v.photo_link ? (
                        <img
                          src={v.photo_link}
                          alt={`${v.make ?? "Car"} ${v.model ?? ""} for hire in Meru`}
                          loading="lazy"
                          className="h-28 w-full object-cover sm:h-40"
                        />
                      ) : (
                        <div className="grid h-28 w-full place-items-center bg-secondary text-xs text-muted-foreground sm:h-40">
                          No photo
                        </div>
                      )}
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-foreground sm:text-sm">
                            {[v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                          </p>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              busy
                                ? "bg-secondary text-muted-foreground"
                                : "bg-primary/15 text-primary"
                            }`}
                          >
                            {availabilityLabel}
                          </span>
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground sm:text-xs">
                          {v.plate_number}
                          {v.seats ? ` · ${v.seats} seats` : ""}
                          {v.photo_links.length > 1 ? ` · ${v.photo_links.length} photos` : ""}
                        </p>
                        <p className="mt-1 font-display text-xs font-bold text-foreground sm:text-sm">
                          KES {listedDayTotal(v, tab).toLocaleString("en-KE")} / day
                          {tab === "chauffeured" ? " with chauffeur" : ""}
                        </p>
                        {tab === "chauffeured" ? (
                          <p className="text-[10px] text-muted-foreground">
                            Car KES {Number(v.day_rate).toLocaleString("en-KE")} + chauffeur KES{" "}
                            {Number(v.chauffeur_daily_rate).toLocaleString("en-KE")}
                          </p>
                        ) : null}
                        <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">
                          {insuranceLabel(v.hire_insurance_type)}
                          {v.hire_minimum_age ? ` · Minimum age ${v.hire_minimum_age}+` : ""}
                        </p>
                        {features.length ? (
                          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                            {features.slice(0, 3).join(" · ")}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] font-medium text-primary">
                          View details and choose times
                        </p>
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {bookingStep === "details" && chosen ? (
          <section className="surface-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-primary">Selected car</p>
                <h2 className="font-display text-lg font-bold text-foreground">
                  {[chosen.make, chosen.model].filter(Boolean).join(" ") || "Vehicle"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Pickup {start?.toLocaleString("en-KE")} · Return{" "}
                  {endDate?.toLocaleString("en-KE")} · {days} day(s)
                </p>
                {estimatedTotal !== null ? (
                  <p className="mt-1 font-display text-base font-bold text-foreground">
                    Total: KES {estimatedTotal.toLocaleString("en-KE")}
                  </p>
                ) : null}
                {chosen && estimatedTotal !== null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {chosen.hire_payment_policy === "daily_flexible"
                      ? `Pay at least KES ${Math.ceil(estimatedTotal / Math.max(1, days)).toLocaleString("en-KE")} for day one; later days can be paid daily or later via the system.`
                      : `Pay KES ${estimatedTotal.toLocaleString("en-KE")} in full before the owner sees the booking.`}
                  </p>
                ) : null}
                {chosen ? (
                  <p className="mt-1 text-xs font-semibold text-foreground">
                    {(() => {
                      const amt = Number(chosen.hire_deposit_amount ?? 0);
                      const kes = `KES ${amt.toLocaleString("en-KE")}`;
                      if (chosen.hire_deposit_policy === "upfront" && amt > 0)
                        return `Plus a refundable deposit of ${kes}, paid with this booking.`;
                      if (chosen.hire_deposit_policy === "handover" && amt > 0)
                        return `Refundable deposit of ${kes} is paid in the app at pickup, before you get the keys.`;
                      return "No deposit for this car.";
                    })()}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setBookingStep("browse");
                  setOpenId(chosen.id);
                }}
                className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground"
              >
                Change car or times
              </button>
            </div>
            {clash ? (
              <p className="mt-2 rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
                This car is no longer available for these times. Select another pickup and return
                window.
              </p>
            ) : null}
          </section>
        ) : null}

        {detailsReady ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-lg font-bold text-foreground">
              Your details and needs
            </h2>
            {chosen ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Selected: {[chosen.make, chosen.model].filter(Boolean).join(" ")} ·{" "}
                {chosen.plate_number}
                {estimatedTotal !== null
                  ? ` · KES ${estimatedTotal.toLocaleString("en-KE")} total for ${days} day(s)`
                  : ""}
              </p>
            ) : null}
            {clash ? (
              <p className="mt-2 rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
                This car is already booked for some of these dates. Choose other dates or another
                car.
              </p>
            ) : null}

            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                {(
                  [
                    { key: "individual", label: "Hiring as a person" },
                    { key: "company", label: "For a company" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setHirerType(o.key)}
                    className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                      hirerType === o.key
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Full name">
                  <input
                    value={renterName}
                    onChange={(e) => setRenterName(e.target.value)}
                    className="input-base"
                  />
                </Field>
                <Field label="ID / passport number">
                  <input
                    value={renterIdNumber}
                    onChange={(e) => setRenterIdNumber(e.target.value)}
                    className="input-base"
                  />
                </Field>
              </div>

              {chosen ? (
                <Field label="M-Pesa phone number">
                  <input
                    value={paymentPhone}
                    onChange={(e) => setPaymentPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="0712 345 678"
                    className="input-base"
                  />
                </Field>
              ) : null}

              {hirerType === "company" ? (
                <Field label="Company or organisation">
                  <input
                    value={organisation}
                    onChange={(e) => setOrganisation(e.target.value)}
                    placeholder="Tukuze Afrika Ltd"
                    className="input-base"
                  />
                </Field>
              ) : null}

              <Field label="Number of people">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  value={peopleText}
                  onChange={(e) => setPeopleText(e.target.value)}
                  onBlur={() => setPeopleText(String(passengers))}
                  className="input-base"
                />
              </Field>
              {chosen?.seats && passengers > chosen.seats ? (
                <p className="text-xs text-destructive">This car has {chosen.seats} seats.</p>
              ) : null}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <p className="col-span-full text-[11px] text-muted-foreground">
                  Upload your ID and driving licence once. They are saved securely to your account
                  and reused for future bookings; upload a replacement only when the document
                  changes.
                </p>
                {savedDocuments.isPending ? (
                  <p className="col-span-full text-[11px] text-muted-foreground">
                    Checking for your saved documents…
                  </p>
                ) : null}
                {savedDocuments.error ? (
                  <p className="col-span-full text-[11px] text-destructive">
                    Could not load saved documents. Upload them again to continue.
                  </p>
                ) : null}
                <label className="col-span-full flex items-start gap-2 rounded-xl bg-secondary/60 p-2.5 text-xs text-foreground">
                  <input type="checkbox" className="mt-0.5" checked={rememberDocs} onChange={(e) => setRememberDocs(e.target.checked)} />
                  <span>Save my ID number, ID and driving licence to my account so future hires are filled in for me.</span>
                </label>
                <UploadBox
                  label="Your ID (photo)"
                  done={Boolean(idPath)}
                  busy={uploading === "id"}
                  onFile={(f) => void upload("id", f)}
                />
                {tab === "self_drive" ? (
                  <UploadBox
                    label="Driving licence (photo)"
                    done={Boolean(licensePath)}
                    busy={uploading === "license"}
                    onFile={(f) => void upload("license", f)}
                  />
                ) : null}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Where should the car be brought?
                </p>
                {pickup ? (
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {pickup.label}
                    </span>
                    <button
                      onClick={() => setPickup(null)}
                      className="rounded-full border border-input px-2 py-1 text-xs text-muted-foreground"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 space-y-2">
                    <button
                      type="button"
                      onClick={capturePickupLocation}
                      disabled={locationBusy}
                      className="w-full rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary disabled:opacity-60"
                    >
                      {locationBusy ? "Capturing location…" : "Use my location"}
                    </button>
                    <p className="text-center text-[11px] text-muted-foreground">
                      or search manually
                    </p>
                    <PlaceSearch
                      placeholder="Search for the collection point"
                      value={null}
                      onPick={(p) => {
                        setPickup({ label: p.label, lat: p.lat, lng: p.lng });
                        setLocationError(null);
                      }}
                    />
                    {locationError ? (
                      <p className="text-xs text-destructive">{locationError}</p>
                    ) : null}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Places you plan to visit
                </p>
                {stops.length ? (
                  <ol className="mt-2 space-y-2">
                    {stops.map((s, i) => (
                      <li
                        key={`${s.label}-${i}`}
                        className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {s.label}
                        </span>
                        <button
                          onClick={() => setStops(stops.filter((_, x) => x !== i))}
                          aria-label="Remove place"
                          className="rounded-full border border-input px-2 py-1 text-xs text-destructive"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <div className="mt-2">
                  <PlaceSearch
                    placeholder="Add a place you will visit"
                    value={null}
                    onPick={(p) =>
                      setStops((c) => [...c, { label: p.label, lat: p.lat, lng: p.lng }])
                    }
                  />
                </div>
              </div>

              <Field label="Anything else we should know?">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="input-base"
                />
              </Field>

              {chosen ? (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs font-semibold text-foreground">Owner's rules</p>
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    {chosen.hire_rules ||
                      (tab === "chauffeured"
                        ? "Fuel is not included. The customer covers fuel for the agreed route/distance, either arranged for that distance or purchased as needed while travelling. No smoking."
                        : "Return the car clean and with the same fuel level. No smoking.")}
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={rulesAccepted}
                      onChange={(e) => setRulesAccepted(e.target.checked)}
                    />
                    I have read and accept the owner's rules
                  </label>
                </div>
              ) : null}

              {hirerType === "company" && chosen ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { k: true, t: "Pay now (M-PESA)", d: "No email check needed" },
                    { k: false, t: "Pay later", d: "Invoice, cheque or bank" },
                  ].map((o) => (
                    <button
                      key={String(o.k)}
                      type="button"
                      onClick={() => setCompanyPayNow(o.k)}
                      className={`rounded-xl border p-3 text-left ${companyPayNow === o.k ? "border-primary bg-primary/10" : "border-border"}`}
                    >
                      <p className="font-semibold text-foreground">{o.t}</p>
                      <p className="text-muted-foreground">{o.d}</p>
                    </button>
                  ))}
                </div>
              ) : null}
              {usePayLater && chosen ? (
                <CorporateHireTerms
                  organisation={organisation}
                  summary={`${[chosen.make, chosen.model].filter(Boolean).join(" ")} ${chosen.plate_number} for ${days} day(s)${estimatedTotal !== null ? ` at KES ${estimatedTotal.toLocaleString("en-KE")}` : ""}`}
                  onChange={setCorporateTerms}
                />
              ) : null}

              <button
                onClick={() => submit.mutate()}
                disabled={!canSubmit}
                className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {submit.isPending
                  ? "Sending…"
                  : usePayLater
                    ? "Sign and book (pay later)"
                    : "Continue and pay by M-Pesa"}
              </button>
              {missing.length && !submit.isPending ? (
                <p className="text-[11px] text-muted-foreground">
                  To continue: {missing.join(", ")}.
                </p>
              ) : null}
              {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
            </div>
          </section>
        ) : null}

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
                      {STATUS_COPY[q.status] ?? q.status}
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
                    (q.status === "confirmed" && !!q.pay_later_method)) ? (
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
                    </div>
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
                                {/* wallet pay */}
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

      {opened ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/50 sm:items-center"
          onClick={() => setOpenId(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card p-4 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-foreground">
                {[opened.make, opened.model].filter(Boolean).join(" ") || "Vehicle"}
              </h3>
              <button
                onClick={() => setOpenId(null)}
                aria-label="Close"
                className="rounded-full border border-input px-3 py-1 text-xs text-foreground"
              >
                ✕
              </button>
            </div>
            {opened.photo_links.length ? (
              <>
                <img
                  src={opened.photo_links[photoIndex] ?? opened.photo_links[0]}
                  alt={`${opened.make ?? "Car"} ${opened.model ?? ""} photo ${photoIndex + 1}`}
                  className="mt-3 h-56 w-full rounded-2xl object-cover"
                />
                {opened.photo_links.length > 1 ? (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {opened.photo_links.map((src, i) => (
                      <button key={src} onClick={() => setPhotoIndex(i)}>
                        <img
                          src={src}
                          alt={`Thumbnail ${i + 1}`}
                          className={`h-14 w-20 rounded-lg object-cover ${
                            i === photoIndex ? "ring-2 ring-primary" : "opacity-70"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-3 grid h-40 place-items-center rounded-2xl bg-secondary text-xs text-muted-foreground">
                No photos yet
              </div>
            )}

            <div className="mt-3 rounded-xl border border-border p-3">
              <p className="text-xs font-semibold text-foreground">
                Choose pickup and return days and times
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Select both days, review the range and price, then confirm below. Price is charged
                per 24-hour block, rounded up, with a one-day minimum.
              </p>
              <ScheduleFields
                startAt={startAt}
                returnAt={returnAt}
                onPickup={updatePickupTime}
                onReturn={setReturnAt}
                bookings={opened.bookings}
                availabilityKnown
              />
              {openClash ? (
                <p className="mt-2 text-xs text-destructive">
                  This car is reserved during part of that period. Choose a different time window.
                </p>
              ) : null}
              {openedTotal !== null && scheduleValid ? (
                <p className="mt-3 font-display text-base font-bold text-foreground">
                  Estimated total: KES {openedTotal.toLocaleString("en-KE")} · {days} day(s)
                </p>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Set both times to see the full rental estimate.
                </p>
              )}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Detail k="Plate" v={opened.plate_number} />
              <Detail k="Seats" v={opened.seats ? String(opened.seats) : "—"} />
              <Detail k="Colour" v={opened.colour ?? "—"} />
              <Detail k="Year" v={opened.year ? String(opened.year) : "—"} />
              <Detail
                k="Price"
                v={`KES ${listedDayTotal(opened, tab).toLocaleString("en-KE")} / day${tab === "chauffeured" ? " with chauffeur" : ""}`}
              />
              {tab === "chauffeured" ? (
                <Detail
                  k="Daily breakdown"
                  v={`Car KES ${Number(opened.day_rate).toLocaleString("en-KE")} + chauffeur KES ${Number(opened.chauffeur_daily_rate).toLocaleString("en-KE")}`}
                />
              ) : null}
            </dl>
            {tab === "chauffeured" ? (
              <p className="mt-2 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                Fuel is not included in the daily hire or chauffeur fee. The customer covers fuel
                for the agreed route/distance, either arranged for that distance or purchased as
                needed while travelling.
              </p>
            ) : null}
            <div className="mt-3 grid gap-2 rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold text-foreground">Hire terms</p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Insurance: </span>
                {insuranceLabel(opened.hire_insurance_type)}
                {opened.hire_insurance_details ? ` — ${opened.hire_insurance_details}` : ""}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Minimum age: </span>
                {opened.hire_minimum_age
                  ? `${opened.hire_minimum_age}+ years`
                  : "No specific age limit listed; valid ID and licence checks still apply."}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Cancellation: </span>
                {opened.hire_cancellation_policy ||
                  "Submit cancellation requests through Twende Meru Rides. Any refund or deduction is subject to platform review; do not settle cancellations off-platform."}
              </p>
            </div>
            {opened.hire_description ? (
              <p className="mt-3 text-sm text-foreground">{opened.hire_description}</p>
            ) : null}

            <div className="mt-3 rounded-xl border border-border p-3">
              <p className="text-xs font-semibold text-foreground">Owner's rules</p>
              <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                {opened.hire_rules ||
                  (tab === "chauffeured"
                    ? "Fuel is not included. The customer covers fuel for the agreed route/distance, either arranged for that distance or purchased as needed while travelling. No smoking."
                    : "Return the car clean and with the same fuel level. No smoking.")}
              </p>
            </div>

            <div className="mt-3">
              <p className="text-xs font-semibold text-foreground">Unavailable dates</p>
              {opened.bookings.length ? (
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {opened.bookings.map((b) => (
                    <li key={b.start}>
                      {new Date(b.start).toLocaleString("en-KE")} –{" "}
                      {new Date(b.end).toLocaleString("en-KE")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Available any day — no upcoming bookings.
                </p>
              )}
            </div>

            {parseFeatures(opened.hire_features).length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold text-foreground">Features</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {parseFeatures(opened.hire_features).map((feature) => (
                    <span
                      key={feature}
                      className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-foreground"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            </div>

            <button
              type="button"
              onClick={() => {
                setVehicleId(opened.id);
                setRulesAccepted(false);
                setBookingStep("details");
                setMessage(null);
                setOpenId(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              disabled={!scheduleValid || openClash}
              className="mt-4 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Confirm dates & continue to renter details
            </button>
          </div>
        </div>
      ) : null}
      <PaymentProgressCard
        open={!!payCard}
        amount={payCard?.amount}
        phone={paymentPhone || null}
        check={async (): Promise<PayState> => {
          if (!payCard) return "pending";
          const { data } = await supabase.from("hire_quotes").select("payment_status").eq("id", payCard.quoteId).maybeSingle();
          const st = String(data?.payment_status ?? "pending");
          if (["paid", "partial", "partially_paid"].includes(st)) return "paid";
          if (["failed", "timed_out", "cancelled"].includes(st)) return "failed";
          return "pending";
        }}
        onSuccess={() => {
          const id = payCard?.quoteId;
          setPayCard(null);
          void queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
          if (id) void navigate({ to: "/hire/agreement/$quoteId", params: { quoteId: id }, hash: "sign" });
        }}
        onRetry={() => { if (payCard) pay.mutate({ quoteId: payCard.quoteId }); }}
        onClose={() => setPayCard(null)}
        successLabel="Sign your agreement"
      />
    </AppShell>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-2">
      <dt className="text-[10px] text-muted-foreground">{k}</dt>
      <dd className="font-medium text-foreground">{v}</dd>
    </div>
  );
}

function ScheduleFields({
  startAt,
  returnAt,
  onPickup,
  onReturn,
  bookings,
  availabilityKnown = false,
}: {
  startAt: string;
  returnAt: string;
  onPickup: (value: string) => void;
  onReturn: (value: string) => void;
  bookings: Vehicle["bookings"];
  availabilityKnown?: boolean;
}) {
  const pickupDate = calendarDay(startAt);
  const returnDate = calendarDay(returnAt);
  const selectedRange: DateRange | undefined = pickupDate
    ? { from: pickupDate, ...(returnDate ? { to: returnDate } : {}) }
    : undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isUnavailable = (date: Date) =>
    date.getTime() < today.getTime() ||
    (availabilityKnown && bookingTouchesDay(date, bookings)) ||
    (dayKey(date) === dayKey(today) &&
      new Date(dateAtClock(date, defaultPickupClock(date))).getTime() <= Date.now());
  const isAvailable = (date: Date) => availabilityKnown && !isUnavailable(date);
  const isBooked = (date: Date) => availabilityKnown && bookingTouchesDay(date, bookings);

  function selectRange(next: DateRange | undefined) {
    if (!next?.from) {
      onPickup("");
      onReturn("");
      return;
    }
    const pickupClock = clockFrom(startAt, defaultPickupClock(next.from));
    const pickupValue = dateAtClock(next.from, pickupClock);
    onPickup(pickupValue);
    if (!next.to) {
      onReturn("");
      return;
    }
    let returnValue = dateAtClock(next.to, clockFrom(returnAt, "10:00"));
    if (new Date(returnValue).getTime() <= new Date(pickupValue).getTime()) {
      const pickup = new Date(pickupValue);
      pickup.setMinutes(pickup.getMinutes() + 60);
      const latestSameDay = new Date(
        next.to.getFullYear(),
        next.to.getMonth(),
        next.to.getDate(),
        23,
        59,
      );
      returnValue = localDateTimeInput(
        pickup.getTime() > latestSameDay.getTime() ? latestSameDay : pickup,
      );
    }
    onReturn(returnValue);
  }

  function setPickupClock(clock: string) {
    if (pickupDate) onPickup(dateAtClock(pickupDate, clock));
  }

  function setReturnClock(clock: string) {
    if (returnDate) onReturn(dateAtClock(returnDate, clock));
  }

  return (
    <div className="mt-3 space-y-3">
      <Calendar
        mode="range"
        selected={selectedRange}
        onSelect={selectRange}
        disabled={isUnavailable}
        excludeDisabled
        modifiers={{
          available: isAvailable,
          booked: isBooked,
        }}
        modifiersClassNames={{
          available: "font-semibold text-emerald-700 hover:bg-emerald-50",
          booked: "text-red-600 line-through opacity-90",
        }}
        showOutsideDays={false}
        className="mx-auto rounded-xl bg-white p-1 text-slate-900 shadow-sm"
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {availabilityKnown ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-full bg-emerald-500" /> Available
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-full bg-red-500" /> Booked / unavailable
            </span>
          </>
        ) : (
          <span>Choose dates; actual vehicle availability is confirmed with the quotation.</span>
        )}
        {availabilityKnown ? <span>Past dates are disabled.</span> : null}
      </div>
      {pickupDate ? (
        <p className="text-xs text-muted-foreground">
          Dates: {pickupDate.toLocaleDateString("en-KE")} –{" "}
          {(returnDate ?? pickupDate).toLocaleDateString("en-KE")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Select a pickup day, then a return day.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pickup time">
          <input
            type="time"
            value={startAt ? startAt.slice(11, 16) : ""}
            {...(pickupDate && dayKey(pickupDate) === dayKey(today)
              ? { min: clockFrom(localDateTimeInput(new Date()), "") }
              : {})}
            disabled={!pickupDate}
            onChange={(event) => setPickupClock(event.target.value)}
            className="input-base"
          />
        </Field>
        <Field label="Return time">
          <input
            type="time"
            value={returnAt ? returnAt.slice(11, 16) : ""}
            {...(pickupDate && returnDate && dayKey(pickupDate) === dayKey(returnDate)
              ? { min: startAt.slice(11, 16) }
              : {})}
            disabled={!returnDate}
            onChange={(event) => setReturnClock(event.target.value)}
            className="input-base"
          />
        </Field>
      </div>
    </div>
  );
}

function UploadBox({
  label,
  done,
  busy,
  onFile,
}: {
  label: string;
  done: boolean;
  busy: boolean;
  onFile: (f: File) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-input px-3 py-3 text-xs">
      <span className="font-medium text-foreground">{label}</span>
      <span className={done ? "text-primary" : "text-muted-foreground"}>
        {busy ? "Uploading…" : done ? "Saved · reuse ✓" : "Upload"}
      </span>
      <input
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

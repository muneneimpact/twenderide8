import { Link, useNavigate } from "@tanstack/react-router";
import { PaymentProgressCard, type PayState } from "@/components/PaymentProgressCard";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { DateRange } from "react-day-picker";
import { CorporateHireTerms, type CorporateTerms } from "@/components/CorporateHireTerms";
import { AppShell } from "@/components/AppShell";
import { PlaceSearch } from "@/components/PlaceSearch";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import {
  estimateHireTotal,
  getMyBusinessKyc,
  checkHirePaymentNow,
  getMyHireDocuments,
  getPublicHireBrand,
  listHireVehicles,
  payHireBooking,
  saveBusinessKycDocument,
  saveMyHireDocument,
  submitHireQuote,
} from "@/lib/hire.functions";
import { clearRememberedHireVehicle, readRememberedHireVehicle } from "@/lib/hire-selection";
import { HourlyCharterBrowse } from "@/components/HourlyCharterBrowse";

type KycKind = "certificate" | "kra_pin" | "cr12" | "other";
const KYC_SLOTS: Array<{ kind: KycKind; label: string }> = [
  { kind: "certificate", label: "Certificate of registration" },
  { kind: "kra_pin", label: "KRA PIN certificate" },
  { kind: "cr12", label: "CR12 / directors list" },
];

export const Route = createFileRoute("/_authenticated/hire")({
  validateSearch: z.object({ owner: z.string().optional(), vehicle: z.string().optional() }),
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

const DAY = 86_400_000;

interface Place {
  label: string;
  lat: number | null;
  lng: number | null;
}

type Vehicle = Awaited<ReturnType<typeof listHireVehicles>>[number];
type HireBookingStep =
  | "browse"
  | "dates"
  | "service"
  | "drive"
  | "details"
  | "pickup"
  | "review"
  | "hourly"
  | "hourlyDone";
type ProgressStep = { key: string; label: string };

function BookingProgress({ steps, currentKey }: { steps: ProgressStep[]; currentKey: string }) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.key === currentKey),
  );
  const currentStep = steps[currentIndex] ?? steps[0];
  const progress = steps.length ? ((currentIndex + 1) / steps.length) * 100 : 0;
  return (
    <section
      className="mx-3 rounded-2xl border border-border bg-card p-3"
      aria-label="Booking progress"
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <p className="font-semibold text-foreground">
          Step {currentIndex + 1} of {steps.length} · {currentStep?.label}
        </p>
        <p className="text-muted-foreground">Your progress</p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={currentIndex + 1}
        aria-label={`Step ${currentIndex + 1} of ${steps.length}`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {steps.map((step, index) => (
          <li key={step.key} className={index <= currentIndex ? "font-semibold text-primary" : ""}>
            {index + 1}. {step.label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function overlapsRange(vehicle: Vehicle, start: Date, end: Date) {
  return vehicle.bookings.some(
    (booking) =>
      new Date(booking.start).getTime() < end.getTime() &&
      new Date(booking.end).getTime() > start.getTime(),
  );
}

function nextAvailableStart(vehicle: Vehicle, days: number, from = new Date()) {
  let cursor = from.getTime();
  // days <= 0: just "is it free right now / today" (one hour slot), so a car
  // booked from tomorrow still shows as available today.
  const duration = days > 0 ? days * DAY : 60 * 60_000;
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

function lowestListedDayTotal(vehicle: Vehicle) {
  const rates = [
    ...(vehicle.hire_mode !== "chauffeured" ? [listedDayTotal(vehicle, "self_drive")] : []),
    ...(vehicle.hire_mode !== "self_drive" ? [listedDayTotal(vehicle, "chauffeured")] : []),
  ];
  return Math.min(...rates);
}

function insuranceLabel(value: string | null) {
  switch (value) {
    case "comprehensive":
      return "Comprehensive";
    case "third_party_fire_theft":
      return "Third party, fire and theft";
    case "third_party_only":
      return "Third party only";
    case "psv_commercial":
      return "PSV / commercial passenger cover";
    case "other":
      return "Other coverage";
    default:
      return "Not specified";
  }
}

function HirePage() {
  const { owner: ownerSlug, vehicle: preselectedVehicleId } = Route.useSearch();
  const queryClient = useQueryClient();
  const submitFn = useServerFn(submitHireQuote);
  const savedDocsFn = useServerFn(getMyHireDocuments);
  const saveDocFn = useServerFn(saveMyHireDocument);
  const savedKycFn = useServerFn(getMyBusinessKyc);
  const saveKycFn = useServerFn(saveBusinessKycDocument);
  const checkPaymentFn = useServerFn(checkHirePaymentNow);
  const vehiclesFn = useServerFn(listHireVehicles);
  const publicBrandFn = useServerFn(getPublicHireBrand);
  const payFn = useServerFn(payHireBooking);
  const [accountId, setAccountId] = useState<string | null>(null);

  const savedDocuments = useQuery({
    queryKey: ["my-hire-documents", accountId],
    queryFn: () => savedDocsFn(),
    enabled: Boolean(accountId),
  });
  const savedKyc = useQuery({
    queryKey: ["my-business-kyc", accountId],
    queryFn: () => savedKycFn(),
    enabled: Boolean(accountId),
  });
  const vehicles = useQuery({
    queryKey: ["hire-vehicles"],
    queryFn: () => vehiclesFn(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const ownerBrand = useQuery({
    queryKey: ["public-hire-brand", ownerSlug],
    queryFn: () => publicBrandFn({ data: { slug: ownerSlug! } }),
    enabled: Boolean(ownerSlug),
  });

  const [tab, setTab] = useState<"self_drive" | "chauffeured">("self_drive");
  const [driveChoice, setDriveChoice] = useState<"self_drive" | "chauffeured" | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const prefilledVehicle = useRef<string | null>(null);
  const submitLockRef = useRef(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [bookingStep, setBookingStep] = useState<HireBookingStep>("browse");
  const [servicePeriod, setServicePeriod] = useState<"daily" | "hourly">("daily");
  const [hourlyFromChosen, setHourlyFromChosen] = useState(false);

  // Filters
  const [fSeats, setFSeats] = useState("");
  const [fMake, setFMake] = useState("");
  const [fModel, setFModel] = useState("");
  const [fMaxPrice, setFMaxPrice] = useState("");

  // Hirer details and needs
  const [hirerType, setHirerType] = useState<"individual" | "company">("individual");
  const [companyPayNow, setCompanyPayNow] = useState(true);
  const [payCard, setPayCard] = useState<{ quoteId: string; amount?: number | null } | null>(null);
  const [paymentAttemptKey, setPaymentAttemptKey] = useState(0);
  const [submittedQuote, setSubmittedQuote] = useState<{
    id: string;
    reference: string;
    amount: number | null;
  } | null>(null);
  const [initialPaymentChoice, setInitialPaymentChoice] = useState<"full" | "one_day">("one_day");
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
  const [kycPaths, setKycPaths] = useState<Partial<Record<KycKind, string>>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [corporateTerms, setCorporateTerms] = useState<CorporateTerms | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bookedRef, setBookedRef] = useState<string | null>(null);

  useEffect(() => {
    if (!idPath && savedDocuments.data?.idDocumentPath) {
      setIdPath(savedDocuments.data.idDocumentPath);
    }
    if (!licensePath && savedDocuments.data?.licenseDocumentPath) {
      setLicensePath(savedDocuments.data.licenseDocumentPath);
    }
  }, [idPath, licensePath, savedDocuments.data]);

  // Pre-fill saved company KYC documents for repeat hires.
  useEffect(() => {
    if (!savedKyc.data) return;
    setKycPaths((current) => {
      const next = { ...current };
      for (const doc of savedKyc.data) {
        if (!next[doc.document_kind as KycKind]) next[doc.document_kind as KycKind] = doc.file_path;
      }
      return next;
    });
  }, [savedKyc.data]);

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
        if (profile.company_name)
          setOrganisation((current) => current || profile.company_name || "");
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

  const all = useMemo(() => {
    const loaded = vehicles.data ?? [];
    if (!ownerSlug) return loaded;
    const ownerVehicleIds = new Set(ownerBrand.data?.vehicles.map((vehicle) => vehicle.id) ?? []);
    return loaded.filter((vehicle) => ownerVehicleIds.has(vehicle.id));
  }, [ownerBrand.data, ownerSlug, vehicles.data]);
  useEffect(() => {
    const requestedVehicleId = preselectedVehicleId ?? readRememberedHireVehicle();
    if (!requestedVehicleId || prefilledVehicle.current === requestedVehicleId) return;
    if (vehicles.isPending || (Boolean(ownerSlug) && ownerBrand.isPending)) return;
    const requestedVehicle = all.find((vehicle) => vehicle.id === requestedVehicleId);
    prefilledVehicle.current = requestedVehicleId;
    clearRememberedHireVehicle();
    if (!requestedVehicle) {
      setMessage(
        "The selected car is no longer available on this owner page. Choose another car to continue.",
      );
      return;
    }
    setVehicleId(requestedVehicleId);
    setTab(requestedVehicle.hire_mode === "chauffeured" ? "chauffeured" : "self_drive");
    setDriveChoice(
      requestedVehicle.hire_mode === "self_drive" || requestedVehicle.hire_mode === "chauffeured"
        ? requestedVehicle.hire_mode
        : null,
    );
    setOpenId(requestedVehicleId);
    setBookingStep("browse");
    setMessage(null);
  }, [all, ownerBrand.isPending, ownerSlug, preselectedVehicleId, vehicles.isPending]);
  const makes = useMemo(
    () => [...new Set(all.map((v) => v.make).filter(Boolean))] as string[],
    [all],
  );
  const filtered = all.filter((v) => {
    if (fSeats && (v.seats ?? 0) < Number(fSeats)) return false;
    if (fMake && v.make !== fMake) return false;
    if (fModel && !(v.model ?? "").toLowerCase().includes(fModel.toLowerCase())) return false;
    if (fMaxPrice && lowestListedDayTotal(v) > Number(fMaxPrice)) return false;
    return true;
  });

  const listed = [...filtered].sort((a, b) => {
    const aBusy = Boolean(scheduleValid && start && endDate && overlapsRange(a, start, endDate));
    const bBusy = Boolean(scheduleValid && start && endDate && overlapsRange(b, start, endDate));
    if (scheduleValid && aBusy !== bBusy) return aBusy ? 1 : -1;
    const durationDays = days || 1;
    const dur = scheduleValid ? durationDays : 0;
    const nextA = nextAvailableStart(a, dur).getTime();
    const nextB = nextAvailableStart(b, dur).getTime();
    return nextA - nextB || lowestListedDayTotal(a) - lowestListedDayTotal(b);
  });

  const chosen = all.find((v) => v.id === vehicleId) ?? null;

  // If the chosen car's owner doesn't allow pay-later, force Pay now.
  useEffect(() => {
    if (chosen && chosen.hire_pay_later_allowed === false && !companyPayNow) setCompanyPayNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.id, chosen?.hire_pay_later_allowed]);
  const chosenVehicleId = chosen?.id;
  const chosenPaymentPolicy = chosen?.hire_payment_policy;
  useEffect(() => {
    if (chosenVehicleId) {
      setInitialPaymentChoice(chosenPaymentPolicy === "full" ? "full" : "one_day");
    }
  }, [chosenPaymentPolicy, chosenVehicleId]);
  const opened = all.find((v) => v.id === openId) ?? null;
  const supportsHourly = Boolean(
    chosen?.hire_hourly_available && chosen.hire_mode !== "self_drive",
  );
  const supportsBothDriveModes = Boolean(
    chosen && chosen.hire_mode !== "self_drive" && chosen.hire_mode !== "chauffeured",
  );
  const clash = Boolean(
    chosen && scheduleValid && start && endDate && overlapsRange(chosen, start, endDate),
  );
  const hourlyDuration =
    start && endDate ? Math.ceil((endDate.getTime() - start.getTime()) / 3_600_000) : 0;
  const hourlyRangeFits = hourlyDuration > 0 && hourlyDuration <= 24;
  const hourlyDurationHours = Math.max(1, Math.min(24, hourlyDuration));
  const pricingModeReady = !supportsBothDriveModes || driveChoice !== null;
  const detailsReady = scheduleValid && bookingStep === "details" && Boolean(chosen);
  const estimatedHireCost =
    scheduleValid && chosen && pricingModeReady
      ? estimateHireTotal({
          vehicleClass: chosen.vehicle_class,
          driveMode: tab,
          days,
          stops: stops.length,
          dailyRate: Number(chosen.day_rate),
          chauffeurDailyRate: Number(chosen.chauffeur_daily_rate),
        })
      : null;
  const upfrontDeposit =
    chosen?.hire_deposit_policy === "upfront" ? Number(chosen.hire_deposit_amount ?? 0) : 0;
  const estimatedTotal = estimatedHireCost === null ? null : estimatedHireCost + upfrontDeposit;
  const oneDayPayment =
    estimatedHireCost === null || !days
      ? null
      : Math.ceil(estimatedHireCost / days) + upfrontDeposit;
  const selectedPaymentAmount =
    initialPaymentChoice === "full"
      ? (estimatedTotal ?? 0)
      : (oneDayPayment ?? estimatedTotal ?? 0);
  const progressSteps = useMemo<ProgressStep[]>(() => {
    const steps: ProgressStep[] = [
      { key: "car", label: "Choose a car" },
      { key: "dates", label: "Dates" },
    ];
    if (chosen && hourlyFromChosen && servicePeriod === "hourly") {
      if (supportsHourly) steps.push({ key: "service", label: "Hire type" });
      steps.push({ key: "trip", label: "Trip details" }, { key: "request", label: "Request sent" });
      return steps;
    }
    if (chosen && supportsHourly) steps.push({ key: "service", label: "Hire type" });
    if (chosen && supportsBothDriveModes) steps.push({ key: "drive", label: "Drive option" });
    steps.push(
      { key: "details", label: "Your details" },
      { key: "pickup", label: "Pickup & trip" },
      { key: "confirm", label: "Confirm" },
    );
    return steps;
  }, [chosen, hourlyFromChosen, servicePeriod, supportsBothDriveModes, supportsHourly]);
  const progressCurrentKey =
    bookingStep === "browse"
      ? "car"
      : bookingStep === "hourly"
        ? "trip"
        : bookingStep === "hourlyDone"
          ? "request"
          : bookingStep === "review"
            ? "confirm"
            : bookingStep;

  function updatePickupTime(value: string) {
    setStartAt(value);
    if (returnAt && new Date(returnAt).getTime() <= new Date(value).getTime()) setReturnAt("");
  }

  function continueToDailyOptions() {
    if (!chosen) return;
    if (chosen.hire_mode === "self_drive" || chosen.hire_mode === "chauffeured") {
      setTab(chosen.hire_mode);
      setDriveChoice(chosen.hire_mode);
      setBookingStep("details");
      return;
    }
    setDriveChoice(null);
    setBookingStep("drive");
  }

  function backToCarDetails() {
    setServicePeriod("daily");
    setHourlyFromChosen(false);
    setBookingStep("browse");
    setOpenId(chosen?.id ?? null);
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

  async function uploadBiz(kind: KycKind, file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Each document must be 10 MB or smaller.");
      return;
    }
    if (file.type && !file.type.startsWith("image/") && file.type !== "application/pdf") {
      setMessage("Upload a photo or PDF of the document.");
      return;
    }
    setUploading(`biz-${kind}`);
    setMessage(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setUploading(null);
      return;
    }
    const path = `${auth.user.id}/biz-${kind}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
    const { error } = await supabase.storage
      .from("hire-documents")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setUploading(null);
      setMessage(error.message);
      return;
    }
    try {
      // Business documents are always kept on the account so any phone sees them.
      await saveKycFn({ data: { kind, filePath: path, remember: true } });
      setKycPaths((current) => ({ ...current, [kind]: path }));
      void queryClient.invalidateQueries({ queryKey: ["my-business-kyc"] });
      setMessage("Business document saved to your account — it will be reviewed for approval.");
    } catch (error) {
      await supabase.storage.from("hire-documents").remove([path]);
      setMessage((error as Error).message);
    } finally {
      setUploading(null);
    }
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
      await saveDocFn({ data: { kind, filePath: path, remember: false } });
      if (kind === "id") setIdPath(path);
      else setLicensePath(path);
      setMessage(
        `${kind === "id" ? "ID" : "Driving licence"} attached to this booking. Your save preference will be applied when you confirm.`,
      );
    } catch (error) {
      await supabase.storage.from("hire-documents").remove([path]);
      setMessage((error as Error).message);
    } finally {
      setUploading(null);
    }
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (rememberDocs) {
        if (idPath) await saveDocFn({ data: { kind: "id", filePath: idPath, remember: true } });
        if (licensePath)
          await saveDocFn({ data: { kind: "license", filePath: licensePath, remember: true } });
        void queryClient.invalidateQueries({ queryKey: ["my-hire-documents"] });
      }
      return submitFn({
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
          initialPayment: initialPaymentChoice,
          corporate: usePayLater && corporateTerms ? corporateTerms : undefined,
          kycDocuments: usePayLater
            ? (Object.entries(kycPaths) as Array<[KycKind, string]>)
                .filter(([, path]) => Boolean(path))
                .map(([kind, path]) => ({ kind, path, remember: rememberDocs }))
            : undefined,
        },
      });
    },
    onSuccess: (row) => {
      submitLockRef.current = true;
      const paymentAmount = row.payment ? Number(row.payment.amount) : null;
      setSubmittedQuote({ id: row.id, reference: row.reference, amount: paymentAmount });
      // Remember ID and company so repeat bookings are pre-filled.
      if (accountId && rememberDocs) {
        void supabase
          .from("profiles")
          .update({
            id_number: renterIdNumber.trim() || null,
            ...(hirerType === "company" && organisation.trim()
              ? { company_name: organisation.trim() }
              : {}),
          })
          .eq("id", accountId);
      }
      if (usePayLater && corporateTerms) {
        setBookedRef(row.reference);
        setMessage(
          `Booking ${row.reference} sent. The owner will verify your company documents, then your dates are reserved. Pay by ${corporateTerms.payLaterMethod.replace("_", " ")} on ${corporateTerms.payLaterDueDate}.`,
        );
        // Take the company straight to the agreement to sign and save it.
        void navigate({
          to: "/hire/agreement/$quoteId",
          params: { quoteId: row.id },
          hash: "sign",
        });
      } else {
        setMessage(
          row.payment
            ? row.payment.accepted
              ? `Request ${row.reference} saved. Approve the M-Pesa prompt for KES ${Number(row.payment.amount).toLocaleString("en-KE")}; the owner sees it after the required payment clears.`
              : `Request ${row.reference} saved, but payment did not start: ${row.payment.message}. Retry from Your requests.`
            : `Request ${row.reference} sent. Estimate KES ${Number(row.estimated_total).toLocaleString("en-KE")} — a provider will respond.`,
        );
      }
      if (row.payment) {
        setPayCard({ quoteId: row.id, amount: paymentAmount });
        setPaymentAttemptKey((key) => key + 1);
      }
      queryClient.invalidateQueries({ queryKey: ["hire-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
    },
    onError: (error) => {
      submitLockRef.current = false;
      setMessage((error as Error).message);
    },
  });

  const pay = useMutation({
    mutationFn: (vars: { quoteId: string; amount?: number }) =>
      payFn({ data: { ...vars, phone: paymentPhone.trim() || undefined } }),
    onSuccess: (result, vars) => {
      if (result.accepted) {
        const amount = Number(result.amount ?? vars.amount) || null;
        setPayCard({ quoteId: vars.quoteId, amount });
        setPaymentAttemptKey((key) => key + 1);
      }
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

  const payLaterBlocked = Boolean(chosen && chosen.hire_pay_later_allowed === false);
  const kycCount = Object.values(kycPaths).filter(Boolean).length;
  const missing: string[] = [];
  if (!vehicleId) missing.push("choose a vehicle");
  if (!scheduleValid) missing.push("choose a future pickup and return time within 90 days");
  if (!pickup) missing.push("set where the car is brought");
  if (!renterName.trim()) missing.push("enter your name");
  if (chosen && !usePayLater && !paymentPhone.trim())
    missing.push("enter your M-Pesa phone number");
  if (chosen && supportsBothDriveModes && !driveChoice) missing.push("choose who will drive");
  if (chosen?.seats != null && passengers > chosen.seats)
    missing.push(`limit passengers to ${chosen.seats} seats`);
  if (hirerType === "company" && !organisation.trim()) missing.push("enter the company name");
  if (usePayLater && !corporateTerms)
    missing.push("verify the business email, pick a payment date and sign the agreement");
  void kycCount; // business documents are optional
  if (!idPath && !savedDocuments.isPending) missing.push("upload your ID");
  if (tab === "self_drive" && !licensePath && !savedDocuments.isPending)
    missing.push("upload your driving licence");
  if (chosen && !rulesAccepted) missing.push("accept the owner's rules");
  if (clash) missing.push("choose available pickup and return times");
  const contactMissing: string[] = [];
  if (!renterName.trim()) contactMissing.push("enter your name");
  if (hirerType === "company" && !organisation.trim())
    contactMissing.push("enter the company name");
  const canContinueContact = contactMissing.length === 0;
  const canSubmit =
    missing.length === 0 && !submit.isPending && !savedDocuments.isPending && !submittedQuote;
  if (servicePeriod === "hourly") {
    return (
      <AppShell title="Hourly trips with a driver">
        <div className="space-y-4 pb-24">
          {hourlyFromChosen ? (
            <BookingProgress steps={progressSteps} currentKey={progressCurrentKey} />
          ) : (
            <div className="mx-3 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-1">
              <button
                type="button"
                className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                By the hour
              </button>
              <button
                type="button"
                onClick={() => setServicePeriod("daily")}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-foreground"
              >
                By the day · car hire
              </button>
            </div>
          )}
          <div className="mx-3">
            <Link
              to="/hire/bookings"
              className="block rounded-full border border-input px-3 py-2 text-center text-xs font-semibold text-foreground"
            >
              Your requests and offers
            </Link>
          </div>
          <HourlyCharterBrowse
            ownerSlug={ownerSlug}
            {...(hourlyFromChosen && chosen
              ? {
                  preselectedVehicleId: chosen.id,
                  initialStartAt: startAt,
                  initialHours: hourlyDurationHours,
                  onBack: () => {
                    setServicePeriod("daily");
                    setHourlyFromChosen(false);
                    setBookingStep("service");
                  },
                  onSelectAnotherCar: () => {
                    setServicePeriod("daily");
                    setHourlyFromChosen(false);
                    setVehicleId(null);
                    setDriveChoice(null);
                    setOpenId(null);
                    setBookingStep("browse");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  },
                  onSubmitted: () => setBookingStep("hourlyDone"),
                }
              : {})}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Hire a car">
      <div className="space-y-4 pb-24">
        <p className="mx-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
          Payment safety: pay for bookings and instalments only through Twende Meru Rides. Never
          send money directly to a driver or owner; report any pressure to pay outside the system to
          help prevent extortion and fraud.
        </p>
        <BookingProgress steps={progressSteps} currentKey={progressCurrentKey} />
        {bookingStep === "browse" ? (
          <div className="mx-4 grid grid-cols-2 gap-2">
            <Link
              to="/hire/bookings"
              className="rounded-2xl border border-border bg-card p-3 text-left"
            >
              <p className="text-sm font-bold text-foreground">Your bookings</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Requests, payments, agreements & receipts
              </p>
            </Link>
            <Link
              to="/hire/company"
              className="rounded-2xl border border-primary/30 bg-primary/5 p-3 text-left"
            >
              <p className="text-sm font-bold text-primary">Hiring as a company?</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Register company details & KYC once
              </p>
            </Link>
          </div>
        ) : null}
        {bookingStep === "browse" ? (
          <>
            <div className="mx-3 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setServicePeriod("hourly")}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-foreground"
              >
                Browse hourly cars
              </button>
              <button
                type="button"
                onClick={() => setServicePeriod("daily")}
                className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                Browse daily hire cars
              </button>
            </div>
            <p className="mx-4 text-xs text-muted-foreground">
              For cars that offer both daily hire and hourly trips, choose the service after
              selecting your dates. If a car offers both drive options, you will choose who drives
              on the next step.
            </p>
          </>
        ) : null}

        {bookingStep === "browse" ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-lg font-bold text-foreground">
              Available cars for hire{vehicles.isSuccess ? ` · ${listed.length}` : ""}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Browse the cars first. Open one to review its photos, features and terms; select it to
              open the calendar. You will see the total before entering your details.
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

            {vehicles.isPending || (Boolean(ownerSlug) && ownerBrand.isPending) ? (
              <p className="mt-3 text-xs text-muted-foreground">Loading cars…</p>
            ) : null}
            {!vehicles.isPending &&
            !(Boolean(ownerSlug) && ownerBrand.isPending) &&
            listed.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {ownerSlug && !ownerBrand.data
                  ? "This owner page is no longer available. Browse all hire cars instead."
                  : ownerSlug && !ownerBrand.data?.vehicles.length
                    ? "This owner has no cars available for hire right now."
                    : fSeats || fMake || fModel || fMaxPrice
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
                  scheduleValid ? days : 0,
                  new Date(),
                );
                const availabilityLabel = scheduleValid
                  ? busy
                    ? availabilityDateLabel(availabilityFrom)
                    : "Available for your dates"
                  : availabilityDateLabel(availabilityFrom);
                const features = parseFeatures(v.hire_features);
                const supportsSelfDrive = v.hire_mode !== "chauffeured";
                const supportsDriver = v.hire_mode !== "self_drive";
                const selfDriveRate = listedDayTotal(v, "self_drive");
                const driverRate = listedDayTotal(v, "chauffeured");
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
                          From KES {lowestListedDayTotal(v).toLocaleString("en-KE")} / day
                        </p>
                        {supportsSelfDrive && supportsDriver ? (
                          <p className="text-[10px] text-muted-foreground">
                            Drive yourself KES {selfDriveRate.toLocaleString("en-KE")} · With a
                            driver KES {driverRate.toLocaleString("en-KE")}
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">
                            {supportsDriver ? "With a driver" : "Drive it myself"}
                          </p>
                        )}
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
                          View full car details
                        </p>
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {bookingStep === "dates" && chosen ? (
          <section className="space-y-3">
            <div className="surface-card flex flex-wrap items-start justify-between gap-3 p-4">
              <div>
                <p className="text-xs font-semibold text-primary">Selected car</p>
                <h2 className="font-display text-lg font-bold text-foreground">
                  {[chosen.make, chosen.model].filter(Boolean).join(" ") || "Vehicle"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Choose pickup and return dates. Daily hire is charged per 24-hour block, rounded
                  up, with a one-day minimum.
                </p>
              </div>
              <button
                type="button"
                onClick={backToCarDetails}
                className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground"
              >
                Change car
              </button>
            </div>
            <div className="surface-card space-y-3 p-4">
              <p className="text-xs font-semibold text-primary">When do you need it?</p>
              <ScheduleFields
                startAt={startAt}
                returnAt={returnAt}
                onPickup={updatePickupTime}
                onReturn={setReturnAt}
                bookings={chosen.bookings}
                availabilityKnown
              />
              {clash ? (
                <p className="rounded-xl bg-destructive/10 p-2 text-xs text-destructive">
                  This car is not available for those dates. Choose another time or change cars.
                </p>
              ) : null}
            </div>
            <div className="surface-card space-y-3 p-4">
              {estimatedTotal !== null ? (
                <p className="font-display text-base font-bold text-foreground">
                  Estimated total: KES {estimatedTotal.toLocaleString("en-KE")}
                  {upfrontDeposit > 0 ? " · refundable upfront deposit included" : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {scheduleValid && supportsBothDriveModes
                    ? "Choose who will drive on the next step to see your exact total."
                    : "Choose both pickup and return times to see your estimate."}
                </p>
              )}
            </div>
            <div className="surface-card flex flex-col-reverse gap-2 p-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={backToCarDetails}
                className="rounded-full border border-input px-4 py-2.5 text-sm font-semibold text-foreground"
              >
                Back to car details
              </button>
              <button
                type="button"
                disabled={!scheduleValid || clash}
                onClick={() =>
                  supportsHourly ? setBookingStep("service") : continueToDailyOptions()
                }
                className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {supportsHourly
                  ? "Continue to hire type"
                  : supportsBothDriveModes
                    ? "Choose who will drive"
                    : "Continue to your details"}
              </button>
            </div>
          </section>
        ) : null}

        {bookingStep === "service" && chosen && supportsHourly ? (
          <section className="space-y-3">
            <div className="surface-card p-4">
              <p className="text-xs font-semibold text-primary">How do you need this car?</p>
              <h2 className="font-display text-lg font-bold text-foreground">
                Choose a hire option
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Your pickup and return time are saved. Choose the service that best fits your trip.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setServicePeriod("daily");
                setHourlyFromChosen(false);
                continueToDailyOptions();
              }}
              className="surface-card w-full border-2 border-border p-4 text-left transition-colors hover:border-primary"
            >
              <span className="block text-sm font-bold text-foreground">Hire by the day</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Rent for one or more days.{" "}
                {supportsBothDriveModes
                  ? "Choose who will drive next."
                  : "This car's available drive option will be used."}
              </span>
              <span className="mt-2 block text-sm font-semibold text-primary">
                {supportsBothDriveModes
                  ? `From KES ${Math.min(listedDayTotal(chosen, "self_drive"), listedDayTotal(chosen, "chauffeured")).toLocaleString("en-KE")} per day`
                  : `KES ${listedDayTotal(chosen, tab).toLocaleString("en-KE")} per day`}
              </span>
            </button>
            <button
              type="button"
              disabled={!hourlyRangeFits}
              onClick={() => {
                setServicePeriod("hourly");
                setHourlyFromChosen(true);
                setBookingStep("hourly");
              }}
              className="surface-card w-full border-2 border-border p-4 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-sm font-bold text-foreground">
                Car and driver by the hour
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Best for appointments, waiting or several stops. The owner will send a price offer;
                you pay in Twende after accepting.
              </span>
              <span className="mt-2 block text-sm font-semibold text-primary">
                Request an hourly offer
              </span>
            </button>
            {!hourlyRangeFits ? (
              <p className="text-xs text-muted-foreground">
                For an hourly request, choose pickup and return times within 24 hours on the
                previous step.
              </p>
            ) : null}
            <div className="surface-card p-3">
              <button
                type="button"
                onClick={() => setBookingStep("dates")}
                className="rounded-full border border-input px-4 py-2.5 text-sm font-semibold text-foreground"
              >
                Back to dates
              </button>
            </div>
          </section>
        ) : null}

        {bookingStep === "drive" && chosen ? (
          <section className="space-y-3">
            <div className="surface-card p-4">
              <p className="text-xs font-semibold text-primary">Hire by the day</p>
              <h2 className="font-display text-lg font-bold text-foreground">Who will drive?</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose the option you need. The price updates to match your choice.
              </p>
            </div>
            {(
              [
                {
                  key: "self_drive",
                  title: "Drive it myself",
                  rate: listedDayTotal(chosen, "self_drive"),
                },
                {
                  key: "chauffeured",
                  title: "With a driver",
                  rate: listedDayTotal(chosen, "chauffeured"),
                },
              ] as const
            ).map((option) => {
              const tripTotal =
                estimateHireTotal({
                  vehicleClass: chosen.vehicle_class,
                  driveMode: option.key,
                  days,
                  stops: stops.length,
                  dailyRate: Number(chosen.day_rate),
                  chauffeurDailyRate: Number(chosen.chauffeur_daily_rate),
                }) + upfrontDeposit;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setTab(option.key);
                    setDriveChoice(option.key);
                  }}
                  className={`surface-card w-full border-2 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary ${driveChoice === option.key ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border"}`}
                >
                  <span className="block text-sm font-bold text-foreground">{option.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    KES {option.rate.toLocaleString("en-KE")} per day
                    {option.key === "chauffeured"
                      ? " · fuel not included"
                      : " · valid driving licence required"}
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-foreground">
                    Estimated total for {days} day(s): KES {tripTotal.toLocaleString("en-KE")}
                  </span>
                </button>
              );
            })}
            {tab === "chauffeured" ? (
              <p className="rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
                The car comes with a driver. Fuel for the agreed route is paid separately.
              </p>
            ) : null}
            <div className="surface-card flex flex-col-reverse gap-2 p-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setBookingStep(supportsHourly ? "service" : "dates")}
                className="rounded-full border border-input px-4 py-2.5 text-sm font-semibold text-foreground"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setBookingStep("details")}
                disabled={!driveChoice}
                className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Continue to your details
              </button>
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
                    {chosen.hire_payment_policy !== "full"
                      ? `This car allows daily payments. On the review step, choose KES ${(oneDayPayment ?? 0).toLocaleString("en-KE")} for day one or pay the full total now.`
                      : `Pay KES ${estimatedTotal.toLocaleString("en-KE")} in full before the owner sees the booking.`}
                  </p>
                ) : null}
                {chosen ? (
                  <p className="mt-1 text-xs font-semibold text-foreground">
                    {(() => {
                      const amt = Number(chosen.hire_deposit_amount ?? 0);
                      const kes = `KES ${amt.toLocaleString("en-KE")}`;
                      if (chosen.hire_deposit_policy === "upfront" && amt > 0)
                        return `Refundable upfront deposit of ${kes} is included in the total.`;
                      if (chosen.hire_deposit_policy === "handover" && amt > 0)
                        return `Refundable deposit of ${kes} is paid in the app at pickup, before you get the keys.`;
                      return "No deposit for this car.";
                    })()}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setBookingStep("dates")}
                className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground"
              >
                Change dates
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
            <h2 className="font-display text-lg font-bold text-foreground">Your details</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              We have filled in saved account details where available. Add only what is needed for
              this booking, then review everything before paying.
            </p>
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

              <p className="text-xs text-muted-foreground">
                Next, you will add pickup details and any required documents.
              </p>
              <button
                type="button"
                onClick={() => {
                  setBookingStep("pickup");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                disabled={!canContinueContact}
                className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Continue to pickup details
              </button>
              {contactMissing.length ? (
                <p className="text-[11px] text-muted-foreground">
                  To continue: {contactMissing.join(", ")}.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {bookingStep === "pickup" && chosen ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-lg font-bold text-foreground">
              Pickup and trip details
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Set where the car should meet you, add your documents, and check the owner's rules.
            </p>
            <p className="mt-2 rounded-xl bg-secondary/60 p-3 text-xs text-foreground">
              {[chosen.make, chosen.model].filter(Boolean).join(" ")} · {days} day(s) ·{" "}
              {start?.toLocaleString("en-KE")} to {endDate?.toLocaleString("en-KE")}
            </p>
            <div className="mt-3 space-y-3">
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
                  Your ID and driving licence are attached to this booking. Use the option below to
                  save them securely to your account for future hires.
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
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={rememberDocs}
                    onChange={(e) => setRememberDocs(e.target.checked)}
                  />
                  <span>
                    Save my ID number, ID and driving licence to my account so future hires are
                    filled in for me.
                  </span>
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
                      onManualPick={(label) => {
                        setPickup({ label, lat: null, lng: null });
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
                  ].map((o) => {
                    const disabled = !o.k && payLaterBlocked;
                    return (
                      <button
                        key={String(o.k)}
                        type="button"
                        disabled={disabled}
                        onClick={() => setCompanyPayNow(o.k)}
                        className={`rounded-xl border p-3 text-left disabled:opacity-50 ${companyPayNow === o.k ? "border-primary bg-primary/10" : "border-border"}`}
                      >
                        <p className="font-semibold text-foreground">{o.t}</p>
                        <p className="text-muted-foreground">
                          {disabled ? "This owner allows immediate payments only" : o.d}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {usePayLater && chosen ? (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs font-semibold text-foreground">Business documents (KYC)</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Upload at least one. The owner reviews them before your booking is confirmed.
                    {rememberDocs
                      ? " They are saved to your account and reused for future hires."
                      : " Tick the save option above to reuse them for future hires."}
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {KYC_SLOTS.map((slot) => (
                      <UploadBox
                        key={slot.kind}
                        label={slot.label}
                        done={Boolean(kycPaths[slot.kind])}
                        busy={uploading === `biz-${slot.kind}`}
                        onFile={(f) => void uploadBiz(slot.kind, f)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {usePayLater && chosen ? (
                <CorporateHireTerms
                  organisation={organisation}
                  summary={`${[chosen.make, chosen.model].filter(Boolean).join(" ")} ${chosen.plate_number} for ${days} day(s)${estimatedTotal !== null ? ` at KES ${estimatedTotal.toLocaleString("en-KE")}` : ""}`}
                  onChange={setCorporateTerms}
                />
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => setBookingStep("details")}
                  className="rounded-full border border-input px-4 py-2.5 text-sm font-semibold text-foreground"
                >
                  Back to your details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setBookingStep("review");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={!canSubmit}
                  className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Review booking
                </button>
              </div>
              {missing.length && !submit.isPending ? (
                <p className="text-[11px] text-muted-foreground">
                  To continue: {missing.join(", ")}.
                </p>
              ) : null}
              {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
            </div>
          </section>
        ) : null}

        {bookingStep === "review" && chosen ? (
          <section className="surface-card space-y-3 p-4">
            <div>
              <p className="text-xs font-semibold text-primary">Final check</p>
              <h2 className="font-display text-lg font-bold text-foreground">
                Review your booking
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {usePayLater
                  ? "Check these details before sending your company booking request."
                  : "Check these details before we send the M-Pesa payment prompt."}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <Detail
                k="Car"
                v={`${[chosen.make, chosen.model].filter(Boolean).join(" ")} · ${chosen.plate_number}`}
              />
              <Detail k="Hire type" v="By the day" />
              <Detail
                k="Drive option"
                v={(driveChoice ?? tab) === "self_drive" ? "Drive it myself" : "With a driver"}
              />
              <Detail k="Duration" v={`${days} day(s) · ${passengers} passenger(s)`} />
              <Detail k="Pickup" v={start?.toLocaleString("en-KE") ?? "—"} />
              <Detail k="Return" v={endDate?.toLocaleString("en-KE") ?? "—"} />
              <Detail k="Pickup location" v={pickup?.label ?? "—"} />
              <Detail
                k="Estimated total"
                v={`KES ${(estimatedTotal ?? 0).toLocaleString("en-KE")}${upfrontDeposit > 0 ? " (upfront deposit included)" : ""}`}
              />
              <Detail k="Contact name" v={renterName.trim() || "—"} />
              <Detail
                k="M-Pesa number"
                v={usePayLater ? "Not needed for pay later" : paymentPhone.trim() || "—"}
              />
            </dl>

            {!submittedQuote && !usePayLater && chosen.hire_payment_policy !== "full" ? (
              <div className="rounded-xl border border-border p-3">
                <p className="text-sm font-semibold text-foreground">
                  What would you like to pay now?
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This car allows day-by-day payments. The one-day amount is the minimum needed for
                  the owner to see your booking; any remaining balance can be paid later in Twende.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setInitialPaymentChoice("full")}
                    className={`rounded-xl border-2 p-3 text-left ${initialPaymentChoice === "full" ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <span className="block text-xs font-semibold text-foreground">
                      Pay in full now
                    </span>
                    <span className="mt-1 block text-sm font-bold text-primary">
                      KES {(estimatedTotal ?? 0).toLocaleString("en-KE")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInitialPaymentChoice("one_day")}
                    className={`rounded-xl border-2 p-3 text-left ${initialPaymentChoice === "one_day" ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <span className="block text-xs font-semibold text-foreground">
                      Pay the one-day minimum
                    </span>
                    <span className="mt-1 block text-sm font-bold text-primary">
                      KES {(oneDayPayment ?? 0).toLocaleString("en-KE")}
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
            {!submittedQuote && !usePayLater && chosen.hire_payment_policy === "full" ? (
              <p className="rounded-xl border border-border bg-secondary/40 p-3 text-xs text-foreground">
                This owner requires full payment before the booking is sent. We will prompt KES{" "}
                {(estimatedTotal ?? 0).toLocaleString("en-KE")} on your M-Pesa phone.
              </p>
            ) : null}
            {!submittedQuote && usePayLater ? (
              <p className="rounded-xl border border-border bg-secondary/40 p-3 text-xs text-foreground">
                This company booking will be sent for owner review under the pay-later terms you
                signed. No M-Pesa payment is taken now.
              </p>
            ) : !submittedQuote && !usePayLater ? (
              <p className="text-xs text-muted-foreground">
                No payment starts until you confirm below. Approve the M-Pesa prompt on your phone;
                keep payments inside Twende.
              </p>
            ) : null}

            {submittedQuote ? (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                <p className="text-sm font-semibold text-foreground">
                  Request {submittedQuote.reference} has already been sent.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Do not submit another copy. Use your requests to check the booking or continue a
                  payment retry.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to="/hire/bookings"
                    className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground"
                  >
                    View my requests
                  </Link>
                  {!usePayLater && submittedQuote.amount != null ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPayCard({
                          quoteId: submittedQuote.id,
                          amount: submittedQuote.amount,
                        });
                        setPaymentAttemptKey((key) => key + 1);
                      }}
                      className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                    >
                      Check payment or retry
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => setBookingStep("details")}
                  className="rounded-full border border-input px-4 py-2.5 text-sm font-semibold text-foreground"
                >
                  Edit my details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (submitLockRef.current) return;
                    submitLockRef.current = true;
                    submit.mutate();
                  }}
                  disabled={!canSubmit}
                  className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {submit.isPending
                    ? "Starting…"
                    : usePayLater
                      ? "Confirm booking request"
                      : `Confirm details & pay KES ${selectedPaymentAmount.toLocaleString("en-KE")} by M-Pesa`}
                </button>
              </div>
            )}
            {missing.length && !submit.isPending ? (
              <p className="text-[11px] text-muted-foreground">
                To continue: {missing.join(", ")}.
              </p>
            ) : null}
            {message ? (
              <p role="status" className="text-xs text-muted-foreground">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}

        {bookedRef && hirerType === "company" ? (
          <section className="surface-card border-primary/30 p-4">
            <p className="text-sm font-semibold text-foreground">
              Booking {bookedRef} sent for owner verification
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your company details, documents and verified email are kept — book another car for the
              same company without typing them again.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setVehicleId(null);
                  setOpenId(null);
                  setStartAt("");
                  setReturnAt("");
                  setPickup(null);
                  setPeopleText("1");
                  setStops([]);
                  setNotes("");
                  setLocationError(null);
                  if (!rememberDocs) {
                    setIdPath(null);
                    setLicensePath(null);
                  }
                  setRulesAccepted(false);
                  setCorporateTerms(null);
                  setSubmittedQuote(null);
                  setBookedRef(null);
                  setPayCard(null);
                  setPaymentAttemptKey(0);
                  setInitialPaymentChoice("one_day");
                  setDriveChoice(null);
                  setTab("self_drive");
                  setServicePeriod("daily");
                  setHourlyFromChosen(false);
                  submitLockRef.current = false;
                  submit.reset();
                  pay.reset();
                  setBookingStep("browse");
                  setMessage(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
              >
                Book another car
              </button>
              <Link
                to="/hire/bookings"
                className="rounded-full border border-input px-4 py-2 text-xs font-semibold text-foreground"
              >
                Track your bookings
              </Link>
            </div>
          </section>
        ) : null}
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
              <p className="text-xs font-semibold text-foreground">Vehicle details</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Detail k="Plate" v={opened.plate_number} />
                <Detail k="Seats" v={opened.seats ? String(opened.seats) : "—"} />
                <Detail k="Colour" v={opened.colour ?? "—"} />
                <Detail k="Year" v={opened.year ? String(opened.year) : "—"} />
                <Detail
                  k="Drive options"
                  v={
                    opened.hire_mode === "self_drive"
                      ? "Drive it myself"
                      : opened.hire_mode === "chauffeured"
                        ? "With a driver"
                        : "Drive it myself or with a driver"
                  }
                />
                {opened.hire_mode !== "chauffeured" ? (
                  <Detail
                    k="Drive-it-yourself rate"
                    v={`KES ${Number(opened.day_rate).toLocaleString("en-KE")} / day`}
                  />
                ) : null}
                {opened.hire_mode !== "self_drive" ? (
                  <Detail
                    k="With a driver"
                    v={`KES ${listedDayTotal(opened, "chauffeured").toLocaleString("en-KE")} / day`}
                  />
                ) : null}
                <Detail
                  k="Taxi hire by the hour"
                  v={
                    opened.hire_hourly_available && opened.hire_mode !== "self_drive"
                      ? "Available · request an offer"
                      : "Not available"
                  }
                />
                <Detail
                  k="Payment"
                  v={
                    opened.hire_payment_policy !== "full"
                      ? "Pay in full or start with one day"
                      : "Full payment required"
                  }
                />
                <Detail
                  k="Deposit"
                  v={
                    Number(opened.hire_deposit_amount ?? 0) > 0
                      ? `KES ${Number(opened.hire_deposit_amount).toLocaleString("en-KE")} · ${opened.hire_deposit_policy === "upfront" ? "paid with booking" : opened.hire_deposit_policy === "handover" ? "paid at pickup" : "per owner terms"}`
                      : "None listed"
                  }
                />
              </dl>
              {opened.hire_mode !== "self_drive" ? (
                <p className="mt-2 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                  When hiring with a driver, fuel is not included. The customer covers fuel for the
                  agreed route or distance.
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
                    (opened.hire_mode === "chauffeured"
                      ? "Fuel is not included. The customer covers fuel for the agreed route/distance, either arranged for that distance or purchased as needed while travelling. No smoking."
                      : opened.hire_mode === "self_drive"
                        ? "Return the car clean and with the same fuel level. No smoking."
                        : "For self-drive, return the car clean and with the same fuel level. For trips with a driver, fuel is paid separately. No smoking.")}
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

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="rounded-full border border-input px-4 py-3 text-sm font-semibold text-foreground"
              >
                Go back to cars
              </button>
              <button
                type="button"
                onClick={() => {
                  setVehicleId(opened.id);
                  if (opened.hire_mode === "chauffeured") {
                    setTab("chauffeured");
                    setDriveChoice("chauffeured");
                  } else if (opened.hire_mode === "self_drive") {
                    setTab("self_drive");
                    setDriveChoice("self_drive");
                  } else {
                    setTab("self_drive");
                    setDriveChoice(null);
                  }
                  setInitialPaymentChoice(
                    opened.hire_payment_policy === "full" ? "full" : "one_day",
                  );
                  setRulesAccepted(false);
                  setServicePeriod("daily");
                  setHourlyFromChosen(false);
                  setBookingStep("dates");
                  setMessage(null);
                  setOpenId(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
              >
                Select this car
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <PaymentProgressCard
        open={!!payCard}
        attemptKey={paymentAttemptKey}
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
          if (id)
            void navigate({
              to: "/hire/agreement/$quoteId",
              params: { quoteId: id },
              hash: "sign",
            });
        }}
        onRetry={() => {
          if (payCard) {
            pay.mutate({
              quoteId: payCard.quoteId,
              ...(payCard.amount != null ? { amount: payCard.amount } : {}),
            });
          }
        }}
        retrying={pay.isPending}
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

import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listMyVehicles, updateVehicleHire } from "@/lib/hire.functions";
import { AddVehicleForHire } from "@/components/AddVehicleForHire";
import { VehicleOfflineDates } from "@/components/HireOwnerPageControls";

type HireMode = "self_drive" | "chauffeured" | "both";
type Draft = {
  dailyRate: string;
  chauffeurDailyRate: string;
  seats: string;
  hireMode: HireMode;
  paymentPolicy: "full" | "daily_flexible";
  depositPolicy: "upfront" | "handover" | "none";
  payLaterAllowed: boolean;
  depositAmount: string;
  description: string;
  features: string;
  rules: string;
  cancellationPolicy: string;
  applyCancellationPolicyToOwner: boolean;
  insuranceType: string;
  insuranceDetails: string;
  minimumAge: string;
};

function PendingPhotoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img
      src={url}
      alt={`Preview ${file.name}`}
      className="h-16 w-24 shrink-0 rounded-lg object-cover"
    />
  ) : null;
}

export function HireVehicleManager({
  hireOnly = false,
  showAddVehicle = true,
  heading = "My vehicles for hire",
}: {
  hireOnly?: boolean;
  showAddVehicle?: boolean;
  heading?: string;
}) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listMyVehicles);
  const updateFn = useServerFn(updateVehicleHire);
  const vehicles = useQuery({ queryKey: ["my-vehicles"], queryFn: () => listFn() });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pendingPhotos, setPendingPhotos] = useState<Record<string, File[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hourlyOptIn = useMutation({
    mutationFn: ({ vehicleId, enabled }: { vehicleId: string; enabled: boolean }) =>
      updateFn({ data: { vehicleId, hourlyAvailable: enabled } }),
    onSuccess: () => {
      setNotice("Hourly charter setting saved. The car appears in the separate hourly browse when enabled.");
      void queryClient.invalidateQueries({ queryKey: ["my-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const save = useMutation({
    mutationFn: async ({
      vehicle,
      submitForHireReview = false,
    }: {
      vehicle: NonNullable<typeof vehicles.data>[number];
      submitForHireReview?: boolean;
    }) => {
      setBusyId(vehicle.id);
      const draft = drafts[vehicle.id] ?? {
        dailyRate: String(vehicle.hire_daily_rate ?? ""),
        seats: String(vehicle.seats ?? ""),
        hireMode: (vehicle.hire_mode ?? "both") as HireMode,
        paymentPolicy: vehicle.hire_payment_policy === "full" ? "full" : "daily_flexible", depositPolicy: ((vehicle as { hire_deposit_policy?: string }).hire_deposit_policy ?? "none") as Draft["depositPolicy"], payLaterAllowed: Boolean((vehicle as { hire_pay_later_allowed?: boolean }).hire_pay_later_allowed), depositAmount: String((vehicle as { hire_deposit_amount?: number }).hire_deposit_amount || ""),
        description: vehicle.hire_description ?? "",
        features: vehicle.hire_features ?? "",
        rules: vehicle.hire_rules ?? "",
        chauffeurDailyRate: String(vehicle.hire_chauffeur_daily_rate ?? 2500),
        cancellationPolicy:
          vehicle.hire_cancellation_policy ??
          "Submit cancellation requests through Twende Meru Rides. Any refund or deduction is subject to platform review; do not settle cancellations off-platform.",
        applyCancellationPolicyToOwner: false,
        insuranceType: vehicle.hire_insurance_type ?? "",
        insuranceDetails: vehicle.hire_insurance_details ?? "",
        minimumAge: String(vehicle.hire_minimum_age ?? ""),
      };
      const paths: string[] = [];
      for (const file of pendingPhotos[vehicle.id] ?? []) {
        if (!file.type.startsWith("image/")) throw new Error("Only image files can be added.");
        if (file.size > 10 * 1024 * 1024)
          throw new Error("Each vehicle photo must be 10 MB or smaller.");
        const ext =
          file.name
            .split(".")
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${vehicle.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("vehicle-photos").upload(path, file, {
          upsert: false,
          contentType: file.type,
        });
        if (error) throw new Error(`Photo upload failed: ${error.message}`);
        paths.push(path);
      }
      return updateFn({
        data: {
          vehicleId: vehicle.id,
          dailyRate: draft.dailyRate === "" ? null : Number(draft.dailyRate),
          chauffeurDailyRate: Number(draft.chauffeurDailyRate || 0),
          seats: draft.seats === "" ? null : Number(draft.seats),
          hireMode: draft.hireMode,
          paymentPolicy: draft.paymentPolicy,
          depositPolicy: draft.depositPolicy,
          depositAmount: draft.depositPolicy === "none" ? 0 : Number(draft.depositAmount || 0),
          payLaterAllowed: draft.payLaterAllowed,
          description: draft.description.trim() || null,
          features: draft.features.trim() || null,
          rules: draft.rules.trim() || null,
          cancellationPolicy: draft.cancellationPolicy.trim(),
          applyCancellationPolicyToOwner: draft.applyCancellationPolicyToOwner,
          insuranceType: draft.insuranceType
            ? (draft.insuranceType as
                "comprehensive" | "third_party_fire_theft" | "third_party_only" | "psv_commercial" | "other")
            : null,
          insuranceDetails: draft.insuranceDetails.trim() || null,
          minimumAge: draft.minimumAge === "" ? null : Number(draft.minimumAge),
          ...(paths.length ? { addPhotoPaths: paths } : {}),
          ...(submitForHireReview ? { submitForHireReview: true } : {}),
        },
      });
    },
    onSuccess: (result, variables) => {
      setPendingPhotos((current) => ({ ...current, [variables.vehicle.id]: [] }));
      setNotice(
        variables.submitForHireReview
          ? "Hire listing sent to Ops for vehicle inspection and approval."
          : result.cancellationPolicyAppliedToOwner
            ? "Vehicle listing saved. The cancellation policy was applied to your vehicles; approved hire listings are paused for review."
            : "Vehicle listing saved.",
      );
      void queryClient.invalidateQueries({ queryKey: ["my-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-board"] });
    },
    onError: (error) => setNotice((error as Error).message),
    onSettled: () => setBusyId(null),
  });

  function updateDraft<K extends keyof Draft>(
    vehicle: NonNullable<typeof vehicles.data>[number],
    key: K,
    value: Draft[K],
  ) {
    setDrafts((current) => ({
      ...current,
      [vehicle.id]: {
        ...(current[vehicle.id] ?? {
          dailyRate: String(vehicle.hire_daily_rate ?? ""),
          seats: String(vehicle.seats ?? ""),
          hireMode: (vehicle.hire_mode ?? "both") as HireMode,
          paymentPolicy: vehicle.hire_payment_policy === "full" ? "full" : "daily_flexible", depositPolicy: ((vehicle as { hire_deposit_policy?: string }).hire_deposit_policy ?? "none") as Draft["depositPolicy"], payLaterAllowed: Boolean((vehicle as { hire_pay_later_allowed?: boolean }).hire_pay_later_allowed), depositAmount: String((vehicle as { hire_deposit_amount?: number }).hire_deposit_amount || ""),
          description: vehicle.hire_description ?? "",
          features: vehicle.hire_features ?? "",
          rules: vehicle.hire_rules ?? "",
          chauffeurDailyRate: String(vehicle.hire_chauffeur_daily_rate ?? 2500),
          cancellationPolicy:
            vehicle.hire_cancellation_policy ??
            "Submit cancellation requests through Twende Meru Rides. Any refund or deduction is subject to platform review; do not settle cancellations off-platform.",
          applyCancellationPolicyToOwner: false,
          insuranceType: vehicle.hire_insurance_type ?? "",
          insuranceDetails: vehicle.hire_insurance_details ?? "",
          minimumAge: String(vehicle.hire_minimum_age ?? ""),
        }),
        [key]: value,
      },
    }));
  }

  const availability = useMutation({
    mutationFn: (vehicle: NonNullable<typeof vehicles.data>[number]) =>
      updateFn({ data: { vehicleId: vehicle.id, hireAvailable: !vehicle.hire_available } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const removePhoto = useMutation({
    mutationFn: ({ vehicleId, path }: { vehicleId: string; path: string }) =>
      updateFn({ data: { vehicleId, removePhotoPath: path } }),
    onSuccess: () => {
      setNotice("Vehicle photo removed.");
      void queryClient.invalidateQueries({ queryKey: ["my-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const vehicleRows = vehicles.data ?? [];
  const approvedCount = vehicleRows.filter(
    (vehicle) => vehicle.hire_approval_status === "approved",
  ).length;

  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Add photos, features and listing details, then submit the car for an in-person Ops
        inspection and approval. Rental dates are reserved and ride dispatch pauses while a vehicle
        is out on hire.
      </p>
      <p className="mt-2 rounded-xl border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning-foreground">
        Payment safety: all hire payments and instalments must go through Twende Meru Rides. Never
        ask customers to pay you directly or outside the system; this helps prevent extortion and
        protects both parties.
      </p>
      {vehicles.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading your vehicles…</p>
      ) : null}
      {vehicles.isError ? (
        <div role="alert" className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <p className="font-semibold">We couldn’t load your registered vehicles, so we can’t show your listings yet.</p>
          <p className="mt-1">{(vehicles.error as Error).message}</p>
          <button type="button" onClick={() => void vehicles.refetch()} className="mt-2 rounded-full border border-destructive/30 px-3 py-1.5 font-semibold">Try again</button>
        </div>
      ) : null}
      {!vehicles.isPending && !vehicles.isError && vehicleRows.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
          {showAddVehicle
            ? "No approved hire vehicles yet. Add a vehicle below, then complete its photos, daily rate and hire details and submit it for Operations approval."
            : "No vehicle is registered yet. Open the Vehicles tab above and choose ‘Add a car for hire’. Start with the number plate and vehicle class; make, model, colour and year help customers identify it. After vehicle approval, add clear photos, a daily rate and hire details, then submit the hire listing for Operations approval before customers can book it."}
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {vehicleRows.map((vehicle) => {
          const currentHire = vehicle.hire_bookings.find(
            (booking) =>
              booking.status === "confirmed" &&
              new Date(booking.start).getTime() <= Date.now() &&
              new Date(booking.end).getTime() > Date.now(),
          );
          const heldBookings = vehicle.hire_bookings.filter(
            (booking) => new Date(booking.end).getTime() > Date.now(),
          );
          const draft = drafts[vehicle.id] ?? {
            dailyRate: String(vehicle.hire_daily_rate ?? ""),
            seats: String(vehicle.seats ?? ""),
            hireMode: (vehicle.hire_mode ?? "both") as HireMode,
            paymentPolicy: vehicle.hire_payment_policy === "full" ? "full" : "daily_flexible", depositPolicy: ((vehicle as { hire_deposit_policy?: string }).hire_deposit_policy ?? "none") as Draft["depositPolicy"], payLaterAllowed: Boolean((vehicle as { hire_pay_later_allowed?: boolean }).hire_pay_later_allowed), depositAmount: String((vehicle as { hire_deposit_amount?: number }).hire_deposit_amount || ""),
            description: vehicle.hire_description ?? "",
            features: vehicle.hire_features ?? "",
            rules: vehicle.hire_rules ?? "",
            chauffeurDailyRate: String(vehicle.hire_chauffeur_daily_rate ?? 2500),
            cancellationPolicy:
              vehicle.hire_cancellation_policy ??
              "Submit cancellation requests through Twende Meru Rides. Any refund or deduction is subject to platform review; do not settle cancellations off-platform.",
            applyCancellationPolicyToOwner: false,
            insuranceType: vehicle.hire_insurance_type ?? "",
            insuranceDetails: vehicle.hire_insurance_details ?? "",
            minimumAge: String(vehicle.hire_minimum_age ?? ""),
          };
          const photos = pendingPhotos[vehicle.id] ?? [];
          const photoPaths = vehicle.photo_paths;
          const reviewing = vehicle.hire_approval_status === "pending";
          const listingApproved = vehicle.hire_approval_status === "approved";
          const listingLive =
            listingApproved && vehicle.hire_available && vehicle.status === "approved";
          const canRequestReview =
            vehicle.status === "approved" &&
            Number(draft.dailyRate) > 0 &&
            vehicle.photo_links.length + photos.length > 0;
          const hourlyEnabled = Boolean(
            (vehicle as { hire_hourly_available?: boolean }).hire_hourly_available,
          );
          return (
            <article key={vehicle.id} className="rounded-2xl border border-border p-3">
              <button
                type="button"
                onClick={() => setEditingId((id) => (id === vehicle.id ? null : vehicle.id))}
                aria-expanded={editingId === vehicle.id}
                className="flex w-full items-start gap-3 text-left"
              >
                {vehicle.photo_links[0] ? (
                  <img src={vehicle.photo_links[0]} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
                ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {vehicle.plate_number} · vehicle {vehicle.status} · hire{" "}
                  {vehicle.hire_approval_status.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-[11px] font-medium text-foreground">
                  Hire option: {vehicle.hire_mode === "self_drive" ? "Self-drive only" : vehicle.hire_mode === "chauffeured" ? "Chauffeured only" : "Self-drive or chauffeured"}
                </p>
                <p className={`mt-1 text-[11px] font-semibold ${hourlyEnabled ? "text-success" : "text-muted-foreground"}`}>
                  {hourlyEnabled
                    ? "Hourly chauffeured trips: enabled"
                    : vehicle.hire_mode === "self_drive"
                      ? "Hourly trips: set this car to chauffeured or both first"
                      : "Hourly chauffeured trips: off · edit to enable"}
                </p>
                {listingLive ? (
                  <p className="mt-1 text-[11px] font-semibold text-success">
                    Live on the customer Hire page.
                  </p>
                ) : null}
                {vehicle.hire_rejection_reason ? (
                  <p className="mt-1 text-xs text-destructive">
                    Ops note: {vehicle.hire_rejection_reason}
                  </p>
                ) : null}
                {currentHire ? (
                  <p className="mt-1 text-[11px] font-semibold text-warning-foreground">
                    Out on hire until {new Date(currentHire.end).toLocaleString("en-KE")}. Ride
                    dispatch is blocked.
                  </p>
                ) : null}
                {heldBookings.length ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Reserved:{" "}
                    {heldBookings
                      .map(
                        (booking) =>
                          `${new Date(booking.start).toLocaleDateString("en-KE")}–${new Date(booking.end).toLocaleDateString("en-KE")}`,
                      )
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
                <span className="shrink-0 rounded-full border border-input px-3 py-1 text-xs font-semibold text-primary">
                  {editingId === vehicle.id ? "Close" : "Edit"}
                </span>
              </button>

              <VehicleOfflineDates
                vehicleId={vehicle.id}
                vehicleName={[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}
                entries={vehicle.offline_hires}
              />

              {editingId === vehicle.id ? (<>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {vehicle.photo_links.map((src, index) => (
                  <div key={`${src}-${index}`} className="shrink-0">
                    <img
                      src={src}
                      alt={`Vehicle ${index + 1}`}
                      loading="lazy"
                      className="h-16 w-24 rounded-lg object-cover"
                    />
                    {photoPaths[index] ? (
                      <button
                      type="button"
                      disabled={removePhoto.isPending}
                      onClick={() =>
                        removePhoto.mutate({ vehicleId: vehicle.id, path: photoPaths[index] ?? "" })
                      }
                      className="mt-1 w-full text-center text-[10px] font-medium text-destructive disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                {photos.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}`} className="shrink-0">
                    <PendingPhotoPreview file={file} />
                    <button
                      type="button"
                      onClick={() =>
                        setPendingPhotos((current) => ({
                          ...current,
                          [vehicle.id]: (current[vehicle.id] ?? []).filter(
                            (_, photoIndex) => photoIndex !== index,
                          ),
                        }))
                      }
                      className="mt-1 w-full text-center text-[10px] font-medium text-destructive"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {vehicle.photo_links.length === 0 && photos.length === 0 ? (
                  <div className="grid h-16 w-24 shrink-0 place-items-center rounded-lg bg-secondary text-[10px] text-muted-foreground">
                    No photos
                  </div>
                ) : null}
              </div>
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground">
                Add photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    setPendingPhotos((current) => ({
                      ...current,
                      [vehicle.id]: [...(current[vehicle.id] ?? []), ...files].slice(0, 12),
                    }));
                    event.target.value = "";
                  }}
                />
              </label>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:col-span-2 lg:col-span-4">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={hourlyEnabled}
                    disabled={hourlyOptIn.isPending || (vehicle.hire_mode === "self_drive" && !hourlyEnabled)}
                    onChange={(event) => hourlyOptIn.mutate({ vehicleId: vehicle.id, enabled: event.target.checked })}
                  />
                  <span className="text-xs text-foreground">
                    <span className="block font-semibold">Offer this car for chauffeured trips by the hour</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {vehicle.hire_mode === "self_drive"
                        ? "Hourly trips require a driver. Change this car’s hire options to Chauffeured only or Both below, save the change, then enable hourly here."
                        : "It appears separately under “By the hour.” Customers request an offer; you negotiate the total before they pay."}
                    </span>
                  </span>
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Daily price (KES)</span>
                  <input
                    value={draft.dailyRate}
                    inputMode="decimal"
                    onChange={(event) => updateDraft(vehicle, "dailyRate", event.target.value)}
                    className="input-base"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Seats</span>
                  <input
                    value={draft.seats}
                    inputMode="numeric"
                    onChange={(event) => updateDraft(vehicle, "seats", event.target.value)}
                    className="input-base"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-foreground">What hire options does this car support?</span>
                  <select
                    value={draft.hireMode}
                    onChange={(event) =>
                      updateDraft(vehicle, "hireMode", event.target.value as HireMode)
                    }
                    className="input-base"
                  >
                    <option value="self_drive">Self-drive only — customer drives</option>
                    <option value="chauffeured">Chauffeured only — owner supplies a driver</option>
                    <option value="both">Both — self-drive or chauffeured</option>
                  </select>
                  <span className="mt-1 block text-[10px] text-muted-foreground">This choice applies to this car. Customers can only select a service mode you enable.</span>
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Payment terms</span>
                  <select
                    value={draft.paymentPolicy}
                    onChange={(event) =>
                      updateDraft(
                        vehicle,
                        "paymentPolicy",
                        event.target.value as Draft["paymentPolicy"],
                      )
                    }
                    className="input-base"
                  >
                    <option value="full">
                      Full hire amount upfront before the booking is shown
                    </option>
                    <option value="daily_flexible">
                      First day upfront; remaining days can be paid daily or later via the system
                    </option>
                  </select>
                </label>
                <div className="block sm:col-span-2 lg:col-span-4">
                  <span className="text-[11px] text-muted-foreground">Refundable deposit</span>
                  <div className="mt-1 grid gap-2 sm:grid-cols-3">
                    {([
                      ["upfront", "Upfront", "Paid with the booking"],
                      ["handover", "At handover", "Paid in the app at pickup"],
                      ["none", "No deposit", "Nothing to pay"],
                    ] as const).map(([value, title, hint]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateDraft(vehicle, "depositPolicy", value)}
                        className={`rounded-xl border p-2 text-left text-xs ${draft.depositPolicy === value ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground"}`}
                      >
                        <span className="block font-semibold text-foreground">{title}</span>
                        {hint}
                      </button>
                    ))}
                  </div>
                  {draft.depositPolicy !== "none" ? (
                    <input
                      value={draft.depositAmount}
                      inputMode="numeric"
                      placeholder="Deposit amount (KES)"
                      onChange={(event) => updateDraft(vehicle, "depositAmount", event.target.value.replace(/\D/g, ""))}
                      className="input-base mt-2"
                    />
                  ) : null}
                </div>
                <label className="flex items-start gap-2 rounded-xl border border-border p-3 sm:col-span-2 lg:col-span-4">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={draft.payLaterAllowed}
                    onChange={(event) => updateDraft(vehicle, "payLaterAllowed", event.target.checked)}
                  />
                  <span className="text-xs text-foreground">
                    <span className="font-semibold">Allow verified companies to pay later</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Companies that upload their business documents and sign the agreement can book
                      now and pay by invoice, cheque, bank transfer or M-PESA on a date they choose.
                      You review their documents and confirm before the dates are reserved. When off,
                      companies must pay immediately like everyone else.
                    </span>
                  </span>
                </label>
              </div>
              {draft.hireMode !== "self_drive" ? (
                <label className="mt-2 block">
                  <span className="text-[11px] text-muted-foreground">
                    Chauffeur fee per day (KES; added only when hired with a driver)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    value={draft.chauffeurDailyRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      updateDraft(vehicle, "chauffeurDailyRate", event.target.value)
                    }
                    className="input-base"
                  />
                </label>
              ) : null}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Insurance type</span>
                  <select
                    value={draft.insuranceType}
                    onChange={(event) => updateDraft(vehicle, "insuranceType", event.target.value)}
                    className="input-base"
                  >
                    <option value="">Not specified</option>
                    <option value="comprehensive">Comprehensive</option>
                    <option value="third_party_fire_theft">Third party, fire and theft</option>
                    <option value="third_party_only">Third party only</option>
                    <option value="psv_commercial">PSV / commercial passenger cover</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">
                    Minimum hirer age (leave blank if none)
                  </span>
                  <input
                    type="number"
                    min={18}
                    max={100}
                    value={draft.minimumAge}
                    inputMode="numeric"
                    onChange={(event) => updateDraft(vehicle, "minimumAge", event.target.value)}
                    className="input-base"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[11px] text-muted-foreground">
                    Insurance notes or provider (optional)
                  </span>
                  <input
                    value={draft.insuranceDetails}
                    maxLength={200}
                    placeholder="For example, insurer name or other coverage"
                    onChange={(event) =>
                      updateDraft(vehicle, "insuranceDetails", event.target.value)
                    }
                    className="input-base"
                  />
                </label>
              </div>
              <label className="mt-2 block">
                <span className="text-[11px] text-muted-foreground">Short description</span>
                <input
                  value={draft.description}
                  placeholder="Clean, fuel-efficient, ideal for upcountry trips"
                  onChange={(event) => updateDraft(vehicle, "description", event.target.value)}
                  className="input-base"
                />
              </label>
              <label className="mt-2 block">
                <span className="text-[11px] text-muted-foreground">
                  Features customers should know about
                </span>
                <textarea
                  value={draft.features}
                  rows={2}
                  maxLength={800}
                  placeholder="Air conditioning, Bluetooth, 4WD, child seats"
                  onChange={(event) => updateDraft(vehicle, "features", event.target.value)}
                  className="input-base"
                />
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  Separate features with commas. Ops will verify the listing during inspection.
                </span>
              </label>
              <label className="mt-2 block">
                <span className="text-[11px] text-muted-foreground">Your rules for hirers</span>
                <textarea
                  value={draft.rules}
                  rows={3}
                  placeholder="No smoking. Return with the same fuel level."
                  onChange={(event) => updateDraft(vehicle, "rules", event.target.value)}
                  className="input-base"
                />
              </label>
              <label className="mt-2 block">
                <span className="text-[11px] text-muted-foreground">Cancellation policy</span>
                <textarea
                  value={draft.cancellationPolicy}
                  rows={3}
                  maxLength={2000}
                  placeholder="Explain how cancellations are handled. Keep all requests and refunds in the system."
                  onChange={(event) =>
                    updateDraft(vehicle, "cancellationPolicy", event.target.value)
                  }
                  className="input-base"
                />
              </label>
              <label className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.applyCancellationPolicyToOwner}
                  onChange={(event) =>
                    updateDraft(vehicle, "applyCancellationPolicyToOwner", event.target.checked)
                  }
                  className="mt-0.5"
                />
                <span>
                  Apply this cancellation policy to all vehicles I manage. Approved cars stay
                  listed.
                </span>
              </label>

              <button
                type="button"
                onClick={() => save.mutate({ vehicle })}
                disabled={busyId === vehicle.id}
                className="mt-3 w-full rounded-full border border-input px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-50"
              >
                {busyId === vehicle.id ? "Saving…" : "Save changes and photos"}
              </button>
              {!listingApproved && !reviewing ? (
                <button
                  type="button"
                  onClick={() => save.mutate({ vehicle, submitForHireReview: true })}
                  disabled={!canRequestReview || busyId === vehicle.id}
                  className="mt-2 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busyId === vehicle.id
                    ? "Submitting…"
                    : "Submit hire listing for inspection and approval"}
                </button>
              ) : null}
              {reviewing ? (
                <p className="mt-2 rounded-xl bg-warning/10 p-2 text-xs text-warning-foreground">
                  Hire listing is waiting for team inspection and approval.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => availability.mutate(vehicle)}
                disabled={
                  !listingApproved || vehicle.status !== "approved" || availability.isPending
                }
                className={`mt-2 w-full rounded-full px-3 py-2 text-xs font-semibold ${vehicle.hire_available ? "bg-primary text-primary-foreground" : "border border-input bg-secondary text-secondary-foreground"} disabled:opacity-50`}
              >
                {!listingApproved
                  ? "Available after separate hire approval"
                  : vehicle.hire_available
                    ? "Listed for hire — turn off"
                    : "Approved — make available for hire"}
              </button>
              </>) : null}
            </article>
          );
        })}
      </div>
      {showAddVehicle ? <AddVehicleForHire hireOnly={hireOnly} /> : null}
      {notice ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {!approvedCount && vehicleRows.length ? (
        <p className="mt-2 text-[11px] text-muted-foreground">No hire listings are approved yet.</p>
      ) : null}
    </section>
  );
}

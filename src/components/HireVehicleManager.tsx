import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listMyVehicles, updateVehicleHire } from "@/lib/hire.functions";
import { AddVehicleForHire } from "@/components/AddVehicleForHire";

type HireMode = "self_drive" | "chauffeured" | "both";
type Draft = {
  dailyRate: string;
  seats: string;
  hireMode: HireMode;
  paymentPolicy: "full" | "daily_flexible";
  description: string;
  features: string;
  rules: string;
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

export function HireVehicleManager({ hireOnly = false }: { hireOnly?: boolean }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listMyVehicles);
  const updateFn = useServerFn(updateVehicleHire);
  const vehicles = useQuery({ queryKey: ["my-vehicles"], queryFn: () => listFn() });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pendingPhotos, setPendingPhotos] = useState<Record<string, File[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        hireMode: (vehicle.hire_mode ?? "self_drive") as HireMode,
        paymentPolicy: vehicle.hire_payment_policy === "daily_flexible" ? "daily_flexible" : "full",
        description: vehicle.hire_description ?? "",
        features: vehicle.hire_features ?? "",
        rules: vehicle.hire_rules ?? "",
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
          seats: draft.seats === "" ? null : Number(draft.seats),
          hireMode: draft.hireMode,
          paymentPolicy: draft.paymentPolicy,
          description: draft.description.trim() || null,
          features: draft.features.trim() || null,
          rules: draft.rules.trim() || null,
          ...(paths.length ? { addPhotoPaths: paths } : {}),
          ...(submitForHireReview ? { submitForHireReview: true } : {}),
        },
      });
    },
    onSuccess: (_result, variables) => {
      setPendingPhotos((current) => ({ ...current, [variables.vehicle.id]: [] }));
      setNotice(
        variables.submitForHireReview
          ? "Hire listing sent to Ops for vehicle inspection and approval."
          : "Vehicle listing saved.",
      );
      void queryClient.invalidateQueries({ queryKey: ["my-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-board"] });
    },
    onError: (error) => setNotice((error as Error).message),
    onSettled: () => setBusyId(null),
  });

  function updateDraft(
    vehicle: NonNullable<typeof vehicles.data>[number],
    key: keyof Draft,
    value: string,
  ) {
    setDrafts((current) => ({
      ...current,
      [vehicle.id]: {
        ...(current[vehicle.id] ?? {
          dailyRate: String(vehicle.hire_daily_rate ?? ""),
          seats: String(vehicle.seats ?? ""),
          hireMode: (vehicle.hire_mode ?? "self_drive") as HireMode,
          paymentPolicy:
            vehicle.hire_payment_policy === "daily_flexible" ? "daily_flexible" : "full",
          description: vehicle.hire_description ?? "",
          features: vehicle.hire_features ?? "",
          rules: vehicle.hire_rules ?? "",
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

  const vehicleRows = vehicles.data ?? [];
  const approvedCount = vehicleRows.filter(
    (vehicle) => vehicle.hire_approval_status === "approved",
  ).length;

  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">My vehicles for hire</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Add photos, features and listing details, then submit the car for an in-person Ops
        inspection and approval. Rental dates are reserved and ride dispatch pauses while a vehicle
        is out on hire.
      </p>
      {vehicles.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading your vehicles…</p>
      ) : null}
      {!vehicles.isPending && vehicleRows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          You have no approved vehicles yet. Add a vehicle below or first submit one for vehicle
          approval.
        </p>
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
            hireMode: (vehicle.hire_mode ?? "self_drive") as HireMode,
            paymentPolicy:
              vehicle.hire_payment_policy === "daily_flexible" ? "daily_flexible" : "full",
            description: vehicle.hire_description ?? "",
            features: vehicle.hire_features ?? "",
            rules: vehicle.hire_rules ?? "",
          };
          const photos = pendingPhotos[vehicle.id] ?? [];
          const reviewing = vehicle.hire_approval_status === "pending";
          const listingApproved = vehicle.hire_approval_status === "approved";
          const listingLive =
            listingApproved && vehicle.hire_available && vehicle.status === "approved";
          const canRequestReview =
            vehicle.status === "approved" &&
            Number(draft.dailyRate) > 0 &&
            vehicle.photo_links.length + photos.length > 0;
          return (
            <article key={vehicle.id} className="rounded-2xl border border-border p-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {vehicle.plate_number} · {vehicle.vehicle_class} · vehicle {vehicle.status} · hire{" "}
                  {vehicle.hire_approval_status.replaceAll("_", " ")}
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

              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {vehicle.photo_links.map((src, index) => (
                  <img
                    key={`${src}-${index}`}
                    src={src}
                    alt={`Vehicle ${index + 1}`}
                    loading="lazy"
                    className="h-16 w-24 shrink-0 rounded-lg object-cover"
                  />
                ))}
                {photos.map((file) => (
                  <PendingPhotoPreview key={`${file.name}-${file.lastModified}`} file={file} />
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
                  <span className="text-[11px] text-muted-foreground">Hire type</span>
                  <select
                    value={draft.hireMode}
                    onChange={(event) => updateDraft(vehicle, "hireMode", event.target.value)}
                    className="input-base"
                  >
                    <option value="self_drive">Customer drives</option>
                    <option value="chauffeured">With a driver</option>
                    <option value="both">Either</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Payment terms</span>
                  <select
                    value={draft.paymentPolicy}
                    onChange={(event) => updateDraft(vehicle, "paymentPolicy", event.target.value)}
                    className="input-base"
                  >
                    <option value="full">Full hire amount before booking is shown</option>
                    <option value="daily_flexible">First day upfront, then daily payments</option>
                  </select>
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
            </article>
          );
        })}
      </div>
      <AddVehicleForHire hireOnly={hireOnly} />
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

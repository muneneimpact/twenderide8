import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { AppShell, driverTabs } from "@/components/AppShell";
import {
  applyAsDriver,
  addVehicleForDriver,
  getDriverOnboarding,
  getMyPhotoUrl,
  saveDriverPhoto,
  updateProfile,
} from "@/lib/account.functions";

import { supabase } from "@/integrations/supabase/client";
import { formatKenyanPlate } from "@/lib/plate";
import { CarBadge } from "@/components/CarBadge";
import { DriverComplianceDocuments } from "@/components/DriverComplianceDocuments";
import { DriverAgreementCard } from "@/components/DriverAgreementCard";
import { DRIVER_AGREEMENT_VERSION } from "@/lib/driver-agreement";

export const Route = createFileRoute("/_authenticated/driver/apply")({
  validateSearch: (search) =>
    z.object({ fullName: z.string().optional(), phone: z.string().optional() }).parse(search),
  head: () => ({
    meta: [
      { title: "Driver onboarding — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Apply to drive with Twende Meru Rides in Meru: submit your contact details, vehicle and compliance documents for operations review.",
      },
      { property: "og:title", content: "Become a Twende Meru Rides driver" },
      { property: "og:description", content: "Register your vehicle and documents for Twende Meru Rides driver approval." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DriverApply,
});

const statusTone: Record<string, string> = {
  approved: "bg-success/15 text-success",
  pending: "bg-warning/20 text-warning-foreground",
  rejected: "bg-destructive/15 text-destructive",
  restricted: "bg-destructive/15 text-destructive",
};

function DriverApply() {
  const { fullName: linkedFullName, phone: linkedPhone } = Route.useSearch();
  const queryClient = useQueryClient();
  const fetchOnboarding = useServerFn(getDriverOnboarding);
  const applyFn = useServerFn(applyAsDriver);
  const addVehicleFn = useServerFn(addVehicleForDriver);
  const profileFn = useServerFn(updateProfile);
  const photoFn = useServerFn(saveDriverPhoto);
  const myPhotoFn = useServerFn(getMyPhotoUrl);

  const board = useQuery({ queryKey: ["driver-onboarding"], queryFn: () => fetchOnboarding({}) });
  const photo = useQuery({ queryKey: ["driver-photo"], queryFn: () => myPhotoFn({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["driver-onboarding"] });

  const [fullName, setFullName] = useState(linkedFullName ?? "");
  const [phone, setPhone] = useState(linkedPhone ?? "");
  const [plate, setPlate] = useState("");
  const [vehicleClass, setVehicleClass] = useState<"boda" | "e_boda" | "go" | "plus" | "comfort" | "xl">("go");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [year, setYear] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signer, setSigner] = useState("");

  /** Riders see this photo once they are matched, so it is stored on the profile. */
  const savePhoto = useMutation({
    mutationFn: async () => {
      if (!photoFile) throw new Error("Choose a photo first.");
      const { data: session } = await supabase.auth.getUser();
      const userId = session.user?.id;
      if (!userId) throw new Error("Your session expired. Sign in again.");
      const extension = photoFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${userId}/profile-photo-${Date.now()}.${extension}`;
      const { error } = await supabase.storage
        .from("driver-documents")
        .upload(path, photoFile, { contentType: photoFile.type || "image/jpeg", upsert: true });
      if (error) throw new Error(`Photo upload failed: ${error.message}`);
      return photoFn({ data: { filePath: path } });
    },
    onSuccess: () => {
      setPhotoFile(null);
      void photo.refetch();
    },
  });


  const contact = useMutation({
    mutationFn: () =>
      profileFn({
        data: {
          ...(fullName.trim() ? { full_name: fullName.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
      }),
    onSuccess: invalidate,
  });

  const apply = useMutation({
    mutationFn: () => {
      const vehicleData = {
        plate_number: plate,
        vehicle_class: vehicleClass,
        ...(make.trim() ? { make: make.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(colour.trim() ? { colour: colour.trim() } : {}),
        ...(year.trim() ? { year: Number(year) } : {}),
      };
      if (board.data?.driver?.status === "approved") {
        return addVehicleFn({ data: vehicleData });
      }
      return applyFn({
        data: {
          ...vehicleData,
          agreement_version: DRIVER_AGREEMENT_VERSION,
          agreement_signer_name: signer.trim(),
        },
      });
    },
    onSuccess: () => {
      setPlate("");
      invalidate();
    },
  });

  if (board.isPending) {
    return (
      <AppShell title="Driver onboarding" tabs={driverTabs} eyebrow="Twende Driver">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading your application…</p>
      </AppShell>
    );
  }
  if (board.error) {
    return (
      <AppShell title="Driver onboarding" tabs={driverTabs} eyebrow="Twende Driver">
        <p className="px-4 py-6 text-sm text-destructive">{(board.error as Error).message}</p>
      </AppShell>
    );
  }

  const { driver, profile, vehicles, documents } = board.data!;
  const approvedCount = documents.filter((d) => d.status === "approved").length;

  return (
    <AppShell title="Driver onboarding" tabs={driverTabs} eyebrow="Twende Driver">
      <div className="hero-gradient px-4 pb-8 pt-5">
        <div className="glass-strong mx-auto max-w-md p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-foreground/70">
            Application status
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-brand-foreground">
            {driver ? `Driver profile · ${driver.status}` : "Not applied yet"}
          </h2>
          <p className="mt-1 text-xs text-brand-foreground/75">
            {driver?.status === "approved"
              ? "You are cleared to go online once a vehicle is approved."
              : "Operations reviews every driver, vehicle and document before you can go online."}
          </p>
          <p className="mt-3 text-xs text-brand-foreground/75">
            Vehicles submitted: {vehicles.length} · documents approved: {approvedCount}/{documents.length}
          </p>
          {driver?.status === "approved" && (
            <Link to="/driver" className="mt-3 inline-flex text-sm font-semibold text-brand-foreground">
              Open driver console →
            </Link>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        {/* Step 1 — contact */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">1 · Contact details</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Current: {profile?.full_name ?? "no name"} · {profile?.phone ?? "no phone"}
          </p>
          <div className="mt-3 space-y-2">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name as on your licence"
              maxLength={120}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07xx xxx xxx"
              maxLength={20}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            />
            <button
              onClick={() => contact.mutate()}
              disabled={contact.isPending || (!fullName.trim() && !phone.trim())}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {contact.isPending ? "Saving…" : contact.isSuccess ? "Saved" : "Save contact details"}
            </button>
            {contact.isError && <p className="text-xs text-destructive">{(contact.error as Error).message}</p>}
          </div>
        </section>

        {/* Step 2 — driver photo, shown to the rider once matched */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">2 · Your photo</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            A clear face photo, no cap or sunglasses. Riders see it when you are matched with them so they know who
            is picking them up.
          </p>
          <div className="mt-3 flex items-center gap-3">
            {photo.data?.url ? (
              <img
                src={photo.data.url}
                alt="Your driver photo"
                className="h-20 w-20 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                No photo
              </span>
            )}
            <input
              type="file"
              accept="image/*"
              capture="user"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground"
            />
          </div>
          <button
            onClick={() => savePhoto.mutate()}
            disabled={savePhoto.isPending || !photoFile}
            className="mt-3 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {savePhoto.isPending ? "Uploading…" : photo.data?.url ? "Replace photo" : "Save photo"}
          </button>
          {savePhoto.isError && <p className="mt-2 text-xs text-destructive">{(savePhoto.error as Error).message}</p>}
        </section>

        {/* Step 3 — vehicle */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">3 · Vehicle</h3>
          {driver?.status === "approved" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Your driver account remains approved. This vehicle will be reviewed separately and
              won’t affect your other approved vehicles.
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            <input
              value={plate}
              onChange={(e) => setPlate(formatKenyanPlate(e.target.value))}
              placeholder="Number plate e.g. KDG 568T or KMGT 156X"
              maxLength={16}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm uppercase tracking-wide"
            />

            <div className="grid grid-cols-3 gap-2">
              {(["boda", "e_boda", "go", "plus", "comfort", "xl"] as const).map((cls) => (
                <button
                  key={cls}
                  onClick={() => setVehicleClass(cls)}
                  className={`rounded-2xl px-3 py-2.5 text-sm font-medium capitalize ${
                    vehicleClass === cls
                      ? "bg-primary text-primary-foreground"
                      : "border border-input text-muted-foreground"
                  }`}
                >
                  {cls === "e_boda" ? "e-Boda" : cls}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Make"
                maxLength={40}
                className="rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
              />
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model"
                maxLength={40}
                className="rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
              />
              <input
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                placeholder="Colour"
                maxLength={24}
                className="rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
              />
              <input
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="Year"
                inputMode="numeric"
                className="rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
              />
            </div>
            {driver?.status === "approved" ? null : (
              <DriverAgreementCard
                accepted={agreed}
                onAcceptedChange={setAgreed}
                signer={signer}
                onSignerChange={setSigner}
              />
            )}
            <button
              onClick={() => apply.mutate()}
              disabled={
                apply.isPending ||
                plate.trim().length < 4 ||
                (driver?.status !== "approved" && (!agreed || signer.trim().length < 2))
              }
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {apply.isPending
                ? "Submitting…"
                : driver?.status === "approved"
                  ? "Submit additional vehicle for review"
                  : "Submit vehicle for review"}
            </button>
            {apply.isError && <p className="text-xs text-destructive">{(apply.error as Error).message}</p>}
          </div>

          {vehicles.length > 0 && (
            <ul className="mt-3 divide-y divide-border">
              {vehicles.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <CarBadge
                    colour={v.colour}
                    plate={v.plate_number}
 vehicleClass={v.vehicle_class}
                    detail={[v.colour, v.make, v.model].filter(Boolean).join(" ") || v.vehicle_class}
                  />

                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[v.status] ?? ""}`}>
                    {v.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DriverComplianceDocuments heading="4 · Compliance documents" />
      </div>
    </AppShell>
  );
}

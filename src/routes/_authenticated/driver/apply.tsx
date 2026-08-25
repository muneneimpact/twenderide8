import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, driverTabs } from "@/components/AppShell";
import { applyAsDriver, getDriverOnboarding, submitDocument, updateProfile } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatKenyanPlate } from "@/lib/plate";
import { CarBadge } from "@/components/CarBadge";

export const Route = createFileRoute("/_authenticated/driver/apply")({
  head: () => ({
    meta: [
      { title: "Driver onboarding — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Apply to drive with Twende Ride in Meru: submit your contact details, vehicle and compliance documents for operations review.",
      },
      { property: "og:title", content: "Become a Twende Ride driver" },
      { property: "og:description", content: "Register your vehicle and documents for Twende Ride driver approval." },
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
  const queryClient = useQueryClient();
  const fetchOnboarding = useServerFn(getDriverOnboarding);
  const applyFn = useServerFn(applyAsDriver);
  const docFn = useServerFn(submitDocument);
  const profileFn = useServerFn(updateProfile);

  const board = useQuery({ queryKey: ["driver-onboarding"], queryFn: () => fetchOnboarding({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["driver-onboarding"] });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleClass, setVehicleClass] = useState<"boda" | "economy" | "comfort" | "xl">("economy");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [year, setYear] = useState("");
  const [docType, setDocType] = useState("");
  const [docRef, setDocRef] = useState("");
  const [docExpiry, setDocExpiry] = useState("");
  const [docVehicle, setDocVehicle] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);

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
    mutationFn: () =>
      applyFn({
        data: {
          plate_number: plate,
          vehicle_class: vehicleClass,
          ...(make.trim() ? { make: make.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(colour.trim() ? { colour: colour.trim() } : {}),
          ...(year.trim() ? { year: Number(year) } : {}),
        },
      }),
    onSuccess: () => {
      setPlate("");
      invalidate();
    },
  });

  const addDoc = useMutation({
    mutationFn: async () => {
      let filePath: string | undefined;
      if (docFile) {
        const { data: session } = await supabase.auth.getUser();
        const userId = session.user?.id;
        if (!userId) throw new Error("Your session expired. Sign in again.");
        const extension = docFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const path = `${userId}/${docType}-${Date.now()}.${extension}`;
        const { error } = await supabase.storage
          .from("driver-documents")
          .upload(path, docFile, { contentType: docFile.type || "image/jpeg", upsert: false });
        if (error) throw new Error(`Photo upload failed: ${error.message}`);
        filePath = path;
      }
      return docFn({
        data: {
          documentTypeId: docType,
          reference: docRef,
          ...(docExpiry ? { expiresOn: docExpiry } : {}),
          ...(docVehicle ? { vehicleId: docVehicle } : {}),
          ...(filePath ? { filePath } : {}),
        },
      });
    },
    onSuccess: () => {
      setDocRef("");
      setDocExpiry("");
      setDocFile(null);
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

  const { driver, profile, vehicles, documentTypes, documents } = board.data!;
  const selectedType = documentTypes.find((t) => t.id === docType) ?? null;
  const photoRequired = Boolean(selectedType?.requires_image);
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

        {/* Step 2 — vehicle */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">2 · Vehicle</h3>
          <div className="mt-3 space-y-2">
            <input
              value={plate}
              onChange={(e) => setPlate(formatKenyanPlate(e.target.value))}
              placeholder="Number plate e.g. KDG 568T"
              maxLength={16}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm uppercase tracking-wide"
            />

            <div className="grid grid-cols-3 gap-2">
              {(["economy", "comfort", "xl"] as const).map((cls) => (
                <button
                  key={cls}
                  onClick={() => setVehicleClass(cls)}
                  className={`rounded-2xl px-3 py-2.5 text-sm font-medium capitalize ${
                    vehicleClass === cls
                      ? "bg-primary text-primary-foreground"
                      : "border border-input text-muted-foreground"
                  }`}
                >
                  {cls}
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
            <button
              onClick={() => apply.mutate()}
              disabled={apply.isPending || plate.trim().length < 4}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {apply.isPending ? "Submitting…" : "Submit vehicle for review"}
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

        {/* Step 3 — documents */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">3 · Compliance documents</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Tap a document below to add it. National ID, driving licence and certificate of good conduct need a clear
            photo; the rest only need a reference for now.
          </p>
          <ul className="mt-3 space-y-1.5">
            {documentTypes.map((t) => {
              const mine = documents.find((d) => d.document_type_id === t.id);
              const selected = docType === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setDocType(t.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left text-sm ${
                      selected ? "bg-primary/10 ring-1 ring-primary" : "border border-input"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{t.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.required ? "Required" : "Optional"}
                        {t.requires_image ? " · photo needed" : ""}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        mine ? (statusTone[mine.status] ?? "") : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {mine ? mine.status : "add"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 space-y-2">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            >
              <option value="">Select document type</option>
              {documentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.required ? " (required)" : ""}
                </option>
              ))}
            </select>
            <label className="block text-xs text-muted-foreground">
              {photoRequired ? "Photo of the document (required)" : "Photo of the document (optional)"}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
              />
            </label>
            {docFile && <p className="text-xs text-muted-foreground">Attached: {docFile.name}</p>}
            <input
              value={docRef}
              onChange={(e) => setDocRef(e.target.value)}
              placeholder="Document number / reference"
              maxLength={80}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            />
            <label className="block text-xs text-muted-foreground">
              Expiry date (if any)
              <input
                type="date"
                value={docExpiry}
                onChange={(e) => setDocExpiry(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground"
              />
            </label>
            {vehicles.length > 0 && (
              <select
                value={docVehicle}
                onChange={(e) => setDocVehicle(e.target.value)}
                className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
              >
                <option value="">Not vehicle-specific</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate_number}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => addDoc.mutate()}
              disabled={addDoc.isPending || !docType || docRef.trim().length < 3 || (photoRequired && !docFile)}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {addDoc.isPending ? "Submitting…" : "Submit document"}
            </button>
            {addDoc.isError && <p className="text-xs text-destructive">{(addDoc.error as Error).message}</p>}
          </div>

          {documents.length > 0 && (
            <ul className="mt-3 divide-y divide-border">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">
                      {documentTypes.find((t) => t.id === d.document_type_id)?.label ?? "Document"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.reference}
                      {d.expires_on ? ` · expires ${d.expires_on}` : ""}
                      {d.rejection_reason ? ` · ${d.rejection_reason}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[d.status] ?? ""}`}>
                    {d.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

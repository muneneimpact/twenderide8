import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDriverOnboarding, submitDocument } from "@/lib/account.functions";
import { complianceTodayInKenya, evaluateCompliance } from "@/lib/compliance";

const statusTone: Record<string, string> = {
  approved: "bg-success/15 text-success",
  pending: "bg-warning/20 text-warning-foreground",
  rejected: "bg-destructive/15 text-destructive",
  restricted: "bg-destructive/15 text-destructive",
  expired: "bg-destructive/15 text-destructive",
  missing_expiry: "bg-destructive/15 text-destructive",
};

export function DriverComplianceDocuments({
  heading = "Step 2 · Compliance documents",
  includeDriverDocuments = true,
}: {
  heading?: string;
  includeDriverDocuments?: boolean;
}) {
  const queryClient = useQueryClient();
  const fetchOnboarding = useServerFn(getDriverOnboarding);
  const submitFn = useServerFn(submitDocument);
  const board = useQuery({
    queryKey: ["driver-onboarding"],
    queryFn: () => fetchOnboarding({}),
  });
  const [docType, setDocType] = useState("");
  const [docRef, setDocRef] = useState("");
  const [docExpiry, setDocExpiry] = useState("");
  const [docVehicle, setDocVehicle] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const addDoc = useMutation({
    mutationFn: async () => {
      if (!docType) throw new Error("Choose a document type.");
      let filePath: string | undefined;
      if (docFile) {
        if (docFile.size > 10 * 1024 * 1024) {
          throw new Error("Each compliance document must be 10 MB or smaller.");
        }
        if (
          docFile.type &&
          !docFile.type.startsWith("image/") &&
          docFile.type !== "application/pdf"
        ) {
          throw new Error("Upload a photo or PDF of your compliance document.");
        }
        const { data: session } = await supabase.auth.getUser();
        const userId = session.user?.id;
        if (!userId) throw new Error("Your session expired. Sign in again.");
        const extension =
          docFile.name
            .split(".")
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, "") || "jpg";
        filePath = `${userId}/${docType}-${Date.now()}.${extension}`;
        const { error } = await supabase.storage
          .from("driver-documents")
          .upload(filePath, docFile, { contentType: docFile.type || "image/jpeg", upsert: false });
        if (error) throw new Error(`Compliance document upload failed: ${error.message}`);
      }
      try {
        return await submitFn({
          data: {
            documentTypeId: docType,
            reference: docRef,
            ...(docExpiry ? { expiresOn: docExpiry } : {}),
            ...(docVehicle ? { vehicleId: docVehicle } : {}),
            ...(filePath ? { filePath } : {}),
          },
        });
      } catch (error) {
        if (filePath) {
          await supabase.storage.from("driver-documents").remove([filePath]);
        }
        throw error;
      }
    },
    onSuccess: () => {
      setDocRef("");
      setDocExpiry("");
      setDocVehicle("");
      setDocFile(null);
      setNotice("Compliance document submitted. Operations will review it before approval.");
      void queryClient.invalidateQueries({ queryKey: ["driver-onboarding"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  if (board.isPending) {
    return (
      <section className="surface-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Compliance documents</h2>
        <p className="mt-2 text-xs text-muted-foreground">Loading your document checklist…</p>
      </section>
    );
  }
  if (board.error) {
    return (
      <section className="surface-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Compliance documents</h2>
        <p className="mt-2 text-xs text-destructive">{(board.error as Error).message}</p>
      </section>
    );
  }

  const { documentTypes, documents, vehicles } = board.data;
  const userId = board.data.profile?.id ?? board.data.driver?.id ?? null;
  const today = complianceTodayInKenya();
  const driverCompliance = evaluateCompliance({
    documentTypes,
    documents,
    userId,
    includeDriver: includeDriverDocuments,
    includeOwner: true,
    includeVehicle: false,
  });
  const vehicleCompliance = vehicles.map((vehicle) => ({
    vehicle,
    summary: evaluateCompliance({
      documentTypes,
      documents,
      userId,
      vehicleId: vehicle.id,
      includeDriver: includeDriverDocuments,
      includeOwner: true,
    }),
  }));
  const complianceLabel = (compliant: boolean, requiredCount: number) =>
    requiredCount === 0
      ? "No required documents configured"
      : compliant
        ? "Compliant"
        : "Needs attention";

  return (
    <section id="compliance-documents" className="surface-card scroll-mt-20 p-4">
      <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {includeDriverDocuments
          ? "Driving licence, PSV licence and National ID / Passport are required for driver compliance. "
          : "National ID / Passport and vehicle compliance documents are required for hire owners. "}
        Each hire car needs current insurance with an expiry date. The logbook and roadworthiness
        certificate are optional for now. Compliance is confirmed only after Operations approves the
        required documents.
      </p>
      <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">
            {includeDriverDocuments ? "Driver / owner profile" : "Owner identity"}
          </p>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              driverCompliance.compliant
                ? "bg-success/15 text-success"
                : "bg-warning/20 text-warning-foreground"
            }`}
          >
            {complianceLabel(driverCompliance.compliant, driverCompliance.requiredCount)}
          </span>
        </div>
        {!driverCompliance.compliant && driverCompliance.requiredCount > 0 ? (
          <p className="text-[10px] text-muted-foreground">
            {driverCompliance.items
              .filter((item) => item.status !== "approved")
              .map((item) => `${item.label}: ${item.status.replaceAll("_", " ")}`)
              .join(" · ")}
          </p>
        ) : null}
        {vehicleCompliance.map(({ vehicle, summary }) => (
          <div
            key={vehicle.id}
            className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-2"
          >
            <div>
              <p className="text-xs font-semibold text-foreground">
                {vehicle.plate_number} · vehicle compliance
              </p>
              {!summary.compliant && summary.requiredCount > 0 ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {summary.items
                    .filter((item) => item.status !== "approved")
                    .map((item) => `${item.label}: ${item.status.replaceAll("_", " ")}`)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                summary.compliant
                  ? "bg-success/15 text-success"
                  : "bg-warning/20 text-warning-foreground"
              }`}
            >
              {complianceLabel(summary.compliant, summary.requiredCount)}
            </span>
          </div>
        ))}
      </div>
      {vehicles.length === 0 ? (
        <p className="mt-2 rounded-xl bg-secondary p-2 text-xs text-muted-foreground">
          Add your vehicle in Step 1 first. It will appear here for vehicle-specific documents.
        </p>
      ) : null}
      {documentTypes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No active compliance document types are configured. Contact Operations.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {documentTypes.map((type) => {
            const mine = documents
              .filter(
                (document) =>
                  document.document_type_id === type.id &&
                  (type.applies_to === "vehicle"
                    ? Boolean(docVehicle) && document.subject_vehicle_id === docVehicle
                    : document.subject_user_id === userId && !document.subject_vehicle_id),
              )
              .sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
              )[0];
            const selected = docType === type.id;
            const needsPhoto = Boolean(type.requires_image);
            const needsVehicle = type.applies_to === "vehicle";
            const mineStatus =
              mine?.status === "approved" && type.expires && !mine.expires_on
                ? "missing_expiry"
                : mine?.status === "approved" &&
                    type.expires &&
                    Boolean(mine.expires_on && mine.expires_on < today)
                  ? "expired"
                  : mine?.status;
            return (
              <li
                key={type.id}
                className={`overflow-hidden rounded-2xl border ${
                  selected ? "border-primary bg-accent" : "border-input bg-card"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setDocType(selected ? "" : type.id);
                    setDocRef("");
                    setDocExpiry("");
                    setDocVehicle("");
                    setDocFile(null);
                    setNotice(null);
                    addDoc.reset();
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-foreground">
                      {type.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {type.required ? "Required" : "Optional"}
                      {needsPhoto ? " · photo/scan required" : ""}
                      {needsVehicle
                        ? " · vehicle-specific"
                        : type.applies_to === "owner"
                          ? " · owner identity"
                          : " · driver profile"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      mine
                        ? (statusTone[mineStatus ?? ""] ?? "")
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {mine
                      ? (mineStatus ?? mine.status).replaceAll("_", " ")
                      : selected
                        ? "close"
                        : "add"}
                  </span>
                </button>

                {selected ? (
                  <div className="space-y-2 border-t border-border bg-card px-3 py-3">
                    {needsVehicle && vehicles.length > 0 ? (
                      <select
                        value={docVehicle}
                        onChange={(event) => setDocVehicle(event.target.value)}
                        className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
                      >
                        <option value="">Choose the vehicle</option>
                        {vehicles.map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.plate_number} · {vehicle.make ?? ""} {vehicle.model ?? ""}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <label className="block text-xs font-medium text-muted-foreground">
                      {needsPhoto
                        ? "Photo or PDF of the document (required)"
                        : "Photo or PDF (optional)"}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        capture="environment"
                        onChange={(event) => setDocFile(event.target.files?.[0] ?? null)}
                        className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground"
                      />
                    </label>
                    {docFile ? (
                      <p className="text-xs text-muted-foreground">Attached: {docFile.name}</p>
                    ) : null}
                    <input
                      value={docRef}
                      onChange={(event) => setDocRef(event.target.value)}
                      placeholder={
                        type.code === "vehicle_insurance"
                          ? "Insurer and policy number"
                          : "Document number / reference"
                      }
                      maxLength={80}
                      className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
                    />
                    <label className="block text-xs font-medium text-muted-foreground">
                      Expiry date {type.expires ? "(required)" : "(if any)"}
                      <input
                        type="date"
                        value={docExpiry}
                        onChange={(event) => setDocExpiry(event.target.value)}
                        className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => addDoc.mutate()}
                      disabled={
                        addDoc.isPending ||
                        docRef.trim().length < 3 ||
                        (needsPhoto && !docFile) ||
                        (type.expires && !docExpiry) ||
                        (needsVehicle && !docVehicle)
                      }
                      className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
                    >
                      {addDoc.isPending ? "Submitting…" : `Submit ${type.label}`}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {addDoc.isError ? (
        <p className="mt-2 text-xs text-destructive">{(addDoc.error as Error).message}</p>
      ) : null}
      {notice && !addDoc.isError ? (
        <p className="mt-2 text-xs text-success" role="status">
          {notice}
        </p>
      ) : null}
      {documents.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {documents.map((document) => {
            const documentType = documentTypes.find(
              (type) => type.id === document.document_type_id,
            );
            const documentStatus =
              document.status === "approved" && documentType?.expires && !document.expires_on
                ? "missing_expiry"
                : document.status === "approved" &&
                    documentType?.expires &&
                    Boolean(document.expires_on && document.expires_on < today)
                  ? "expired"
                  : document.status;
            return (
              <li
                key={document.id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{documentType?.label ?? "Document"}</p>
                  <p className="text-xs text-muted-foreground">
                    {document.reference}
                    {document.expires_on ? ` · expires ${document.expires_on}` : ""}
                    {document.rejection_reason ? ` · ${document.rejection_reason}` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    statusTone[documentStatus] ?? ""
                  }`}
                >
                  {documentStatus.replaceAll("_", " ")}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

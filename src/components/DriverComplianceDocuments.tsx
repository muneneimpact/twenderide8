import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDriverOnboarding, submitDocument } from "@/lib/account.functions";

const statusTone: Record<string, string> = {
  approved: "bg-success/15 text-success",
  pending: "bg-warning/20 text-warning-foreground",
  rejected: "bg-destructive/15 text-destructive",
  restricted: "bg-destructive/15 text-destructive",
};

export function DriverComplianceDocuments({
  heading = "Step 2 · Compliance documents",
}: {
  heading?: string;
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

  return (
    <section id="compliance-documents" className="surface-card scroll-mt-20 p-4">
      <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Add or renew driver and vehicle documents here. Required items are marked; each vehicle
        document must be linked to a car. Operations reviews every upload before approval.
      </p>
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
            const mine = documents.find((document) => document.document_type_id === type.id);
            const selected = docType === type.id;
            const needsPhoto = Boolean(type.requires_image);
            const needsVehicle = type.applies_to === "vehicle";
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
                      {needsVehicle ? " · vehicle-specific" : " · driver profile"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      mine
                        ? (statusTone[mine.status] ?? "")
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {mine ? mine.status : selected ? "close" : "add"}
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
                      placeholder="Document number / reference"
                      maxLength={80}
                      className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
                    />
                    <label className="block text-xs font-medium text-muted-foreground">
                      Expiry date (if any)
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
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <div>
                <p className="font-medium text-foreground">
                  {documentTypes.find((type) => type.id === document.document_type_id)?.label ??
                    "Document"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {document.reference}
                  {document.expires_on ? ` · expires ${document.expires_on}` : ""}
                  {document.rejection_reason ? ` · ${document.rejection_reason}` : ""}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  statusTone[document.status] ?? ""
                }`}
              >
                {document.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

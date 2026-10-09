import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getAdminHireVehicleListings } from "@/lib/admin-hire.functions";
import { reviewApproval, setHireListingAvailability } from "@/lib/admin.functions";
import { complianceTodayInKenya } from "@/lib/compliance";

const dateText = (value: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-KE") : "No expiry date";

const display = (value: string | null | undefined) => value?.trim() || "—";

export function AdminHireListingsBoard() {
  const queryClient = useQueryClient();
  const fetchListings = useServerFn(getAdminHireVehicleListings);
  const reviewFn = useServerFn(reviewApproval);
  const availabilityFn = useServerFn(setHireListingAvailability);
  const listings = useQuery({
    queryKey: ["admin-hire-listings"],
    queryFn: () => fetchListings(),
    refetchInterval: 30_000,
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const today = complianceTodayInKenya();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-hire-listings"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-hire-portfolio-finance"] });
  };
  const review = useMutation({
    mutationFn: (input: {
      vehicleId: string;
      target: "vehicle" | "hire_vehicle";
      decision: "approved" | "rejected";
    }) => {
      const note = notes[input.vehicleId]?.trim();
      return reviewFn({
        data: {
          kind: input.target,
          id: input.vehicleId,
          decision: input.decision,
          ...(note ? { note } : {}),
        },
      });
    },
    onSuccess: (_result, input) => {
      setNotice(
        input.target === "vehicle"
          ? `Road vehicle ${input.decision}.`
          : `Hire listing ${input.decision}.`,
      );
      refresh();
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const availability = useMutation({
    mutationFn: (input: { vehicleId: string; available: boolean }) => {
      const note = notes[input.vehicleId]?.trim();
      return availabilityFn({
        data: {
          ...input,
          ...(note ? { note } : {}),
        },
      });
    },
    onSuccess: (_result, input) => {
      setNotice(input.available ? "Hire car published." : "Hire car removed from the marketplace.");
      refresh();
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const data = listings.data;
  const vehicles = data?.vehicles ?? [];
  const pendingCount = vehicles.filter(
    (vehicle) => vehicle.hire_approval_status === "pending",
  ).length;
  const pendingVehicleCount = vehicles.filter((vehicle) => vehicle.status === "pending").length;
  const publicCount = vehicles.filter(
    (vehicle) =>
      vehicle.status === "approved" &&
      vehicle.hire_approval_status === "approved" &&
      vehicle.hire_available,
  ).length;

  return (
    <section className="surface-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Hire fleet inventory & compliance</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Review every hire listing, inspect approved cars and owner documents, and control whether
          approved listings appear in the customer marketplace. Document compliance is calculated
          from Operations-approved, current documents.
        </p>
      </div>
      {listings.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading hire inventory…</p>
      ) : null}
      {listings.error ? (
        <p className="mt-3 text-xs text-destructive">{(listings.error as Error).message}</p>
      ) : null}
      {data ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-border p-3 sm:grid-cols-4">
            <Metric label="Hire listings" value={vehicles.length} />
            <Metric label="Public now" value={publicCount} />
            <Metric label="Road approvals" value={pendingVehicleCount} />
            <Metric label="Awaiting hire review" value={pendingCount} />
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Required documents: {data.requiredDocuments.join(" · ") || "not configured"}. Logbook
            and roadworthiness certificate are optional for now.
          </p>
          {vehicles.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No hire listings or saved hire drafts found.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {vehicles.map((vehicle) => {
                const isPublic =
                  vehicle.status === "approved" &&
                  vehicle.hire_approval_status === "approved" &&
                  vehicle.hire_available;
                const note = notes[vehicle.id] ?? "";
                return (
                  <article key={vehicle.id} className="rounded-2xl border border-border p-3">
                    <div className="flex flex-wrap items-start gap-3">
                      {vehicle.photo_links.length ? (
                        <div className="flex max-w-full gap-2 overflow-x-auto">
                          {vehicle.photo_links.map((url, index) => (
                            <a
                              key={`${vehicle.id}-photo-${index}`}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open vehicle photo ${index + 1}`}
                              className="shrink-0"
                            >
                              <img
                                src={url}
                                alt={`${vehicle.make ?? "Hire car"} ${vehicle.model ?? ""} photo ${index + 1}`}
                                className="h-20 w-28 rounded-xl object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">
                            {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Hire car"}{" "}
                            · {vehicle.plate_number}
                          </h3>
                          <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium capitalize text-secondary-foreground">
                            {vehicle.hire_approval_status.replaceAll("_", " ")}
                          </span>
                          {isPublic ? (
                            <span className="rounded-full bg-success/15 px-2 py-1 text-[10px] font-semibold text-success">
                              Public
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {vehicle.vehicle_class} · {vehicle.year ?? "Year —"} ·{" "}
                          {vehicle.colour ?? "Colour —"} · {vehicle.seats ?? "Seats —"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Owner: {vehicle.owner_name}
                          {vehicle.owner_phone ? ` · ${vehicle.owner_phone}` : ""}
                          {vehicle.fleet_id ? " · fleet" : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Vehicle approval: {vehicle.status} · hire mode:{" "}
                          {display(vehicle.hire_mode)} · payment:{" "}
                          {display(vehicle.hire_payment_policy)}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-foreground">
                          KES {Number(vehicle.hire_daily_rate ?? 0).toLocaleString("en-KE")} / day
                        </p>
                        {vehicle.hire_mode !== "self_drive" ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Chauffeur: KES{" "}
                            {Number(vehicle.hire_chauffeur_daily_rate ?? 2500).toLocaleString(
                              "en-KE",
                            )}{" "}
                            / day
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Insurance: {display(vehicle.hire_insurance_type?.replaceAll("_", " "))}
                          {vehicle.hire_minimum_age
                            ? ` · Minimum hirer age ${vehicle.hire_minimum_age}+`
                            : " · No separate age limit listed"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-semibold text-foreground">Description</p>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {display(vehicle.hire_description)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-foreground">Features</p>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {display(vehicle.hire_features)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-foreground">Rules</p>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {display(vehicle.hire_rules)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-foreground">
                          Cancellation policy
                        </p>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {display(vehicle.hire_cancellation_policy)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-foreground">
                          Insurance details
                        </p>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {display(vehicle.hire_insurance_details)}
                        </p>
                      </div>
                      {vehicle.hire_rejection_reason ? (
                        <div>
                          <p className="text-[10px] font-semibold text-destructive">Review note</p>
                          <p className="text-xs text-muted-foreground">
                            {vehicle.hire_rejection_reason}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">Compliance</p>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                            vehicle.compliance.compliant
                              ? "bg-success/15 text-success"
                              : "bg-warning/20 text-warning-foreground"
                          }`}
                        >
                          {vehicle.compliance.requiredCount === 0
                            ? "Requirements not configured"
                            : vehicle.compliance.compliant
                              ? "Compliant"
                              : "Needs attention"}
                        </span>
                      </div>
                      {vehicle.compliance.items.length ? (
                        <ul className="mt-2 space-y-1">
                          {vehicle.compliance.items.map((item) => (
                            <li
                              key={item.documentTypeId}
                              className="flex justify-between gap-2 text-[10px]"
                            >
                              <span className="text-muted-foreground">{item.label}</span>
                              <span className="font-medium capitalize text-foreground">
                                {item.status.replaceAll("_", " ")}
                                {item.expiresOn ? ` · ${dateText(item.expiresOn)}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {vehicle.documents.length ? (
                        <div className="mt-2 space-y-1 border-t border-border pt-2">
                          {vehicle.documents.map((document) =>
                            (() => {
                              const status =
                                document.status === "approved" &&
                                document.expires &&
                                !document.expires_on
                                  ? "missing expiry"
                                  : document.status === "approved" &&
                                      document.expires &&
                                      Boolean(document.expires_on && document.expires_on < today)
                                    ? "expired"
                                    : document.status;
                              return (
                                <div
                                  key={document.id}
                                  className="flex flex-wrap justify-between gap-2 text-[10px]"
                                >
                                  <span className="text-muted-foreground">
                                    {document.label} · {document.applies_to}
                                    {document.reference ? ` · ${document.reference}` : ""}
                                  </span>
                                  <span className="flex gap-2 font-medium capitalize text-foreground">
                                    {status}
                                    {document.expires_on
                                      ? ` · expires ${dateText(document.expires_on)}`
                                      : ""}
                                    {document.file_link ? (
                                      <a
                                        href={document.file_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary underline"
                                      >
                                        View
                                      </a>
                                    ) : null}
                                  </span>
                                </div>
                              );
                            })(),
                          )}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                      {vehicle.status === "pending" ||
                      vehicle.hire_approval_status === "pending" ? (
                        <input
                          value={note}
                          onChange={(event) =>
                            setNotes({ ...notes, [vehicle.id]: event.target.value })
                          }
                          maxLength={400}
                          placeholder="Optional review note; required if rejecting"
                          className="input-base"
                        />
                      ) : null}
                      {vehicle.status === "pending" ? (
                        <div className="space-y-2 rounded-xl bg-secondary/50 p-3">
                          <p className="text-xs font-semibold text-foreground">
                            Road-vehicle approval is pending
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                review.mutate({
                                  vehicleId: vehicle.id,
                                  target: "vehicle",
                                  decision: "approved",
                                })
                              }
                              disabled={review.isPending}
                              className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                            >
                              Approve vehicle
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                review.mutate({
                                  vehicleId: vehicle.id,
                                  target: "vehicle",
                                  decision: "rejected",
                                })
                              }
                              disabled={review.isPending || !note.trim()}
                              className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-60"
                            >
                              Reject vehicle
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {vehicle.hire_approval_status === "pending" ? (
                        <>
                          {vehicle.status !== "approved" ? (
                            <p className="text-[10px] text-warning-foreground">
                              Approve the vehicle for road use in Operations before approving its
                              hire listing.
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                review.mutate({
                                  vehicleId: vehicle.id,
                                  target: "hire_vehicle",
                                  decision: "approved",
                                })
                              }
                              disabled={review.isPending || vehicle.status !== "approved"}
                              className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                            >
                              Approve & publish
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                review.mutate({
                                  vehicleId: vehicle.id,
                                  target: "hire_vehicle",
                                  decision: "rejected",
                                })
                              }
                              disabled={review.isPending || !note.trim()}
                              className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-60"
                            >
                              Reject with note
                            </button>
                          </div>
                        </>
                      ) : null}
                      {vehicle.hire_approval_status === "approved" ? (
                        <>
                          <input
                            value={note}
                            onChange={(event) =>
                              setNotes({ ...notes, [vehicle.id]: event.target.value })
                            }
                            maxLength={400}
                            placeholder="Optional admin note for publish/unlist audit"
                            className="input-base"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              availability.mutate({
                                vehicleId: vehicle.id,
                                available: !vehicle.hire_available,
                              })
                            }
                            disabled={
                              availability.isPending ||
                              (vehicle.status !== "approved" && !vehicle.hire_available)
                            }
                            className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-60"
                          >
                            {vehicle.hire_available ? "Unlist from marketplace" : "Publish listing"}
                          </button>
                        </>
                      ) : null}
                      {vehicle.hire_approval_status === "rejected" ? (
                        <p className="text-[10px] text-muted-foreground">
                          Waiting for the owner to update the listing and resubmit it for
                          inspection.
                        </p>
                      ) : null}
                      {vehicle.hire_approval_status === "not_submitted" ? (
                        <p className="text-[10px] text-muted-foreground">
                          Saved draft; the owner must submit the hire listing for Operations review.
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : null}
      {notice ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {review.isError || availability.isError ? (
        <p className="mt-2 text-xs text-destructive">
          {((review.error ?? availability.error) as Error).message}
        </p>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

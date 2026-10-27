import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { AppShell } from "@/components/AppShell";
import { AdminSubjectDetail, StatusPill } from "@/components/AdminSubjectDetail";
import { WalletPayoutsBoard } from "@/components/CustomerWalletCard";
import { PartnerInterestRequestsBoard } from "@/components/PartnerInterestRequestsBoard";
import { ApproachFeeSettingsCard } from "@/components/ApproachFeeSettingsCard";
import { getOpsBoard, opsCancelRide, resolveIncident, reviewApproval } from "@/lib/admin.functions";
import { listPendingTrustedBrands, reviewTrustedBrand } from "@/lib/trusted-brand.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Operations board — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Twende Meru Rides operations: approve driver applications, vehicles and documents, monitor live rides and resolve incidents in Meru.",
      },
      { property: "og:title", content: "Twende Meru Rides operations board" },
      {
        property: "og:description",
        content: "Approve drivers, watch live dispatch and resolve incidents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <RoleGate allow={["ops_admin", "super_admin"]} title="Operations">
      <AdminBoard />
    </RoleGate>
  );
}

function AdminBoard() {
  const queryClient = useQueryClient();
  const fetchBoard = useServerFn(getOpsBoard);
  const reviewFn = useServerFn(reviewApproval);
  const cancelFn = useServerFn(opsCancelRide);
  const incidentFn = useServerFn(resolveIncident);
  const trustedBrandsFn = useServerFn(listPendingTrustedBrands);
  const reviewTrustedBrandFn = useServerFn(reviewTrustedBrand);
  const [detail, setDetail] = useState<{ kind: "driver" | "vehicle"; id: string } | null>(null);

  const board = useQuery({
    queryKey: ["ops-board"],
    queryFn: () => fetchBoard({}),
    refetchInterval: 20000,
  });
  const trustedBrands = useQuery({ queryKey: ["admin-trusted-brands"], queryFn: () => trustedBrandsFn() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ops-board"] });
  const [note, setNote] = useState("");

  const review = useMutation({
    mutationFn: (vars: {
      kind: "driver" | "vehicle" | "fleet" | "document" | "hire_vehicle" | "delivery_rate";
      id: string;
      decision: "approved" | "rejected" | "restricted";
    }) => reviewFn({ data: { ...vars, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => {
      setNote("");
      invalidate();
    },
  });
  const cancelRide = useMutation({
    mutationFn: (rideId: string) =>
      cancelFn({ data: { rideId, reason: note.trim() || "Cancelled by operations" } }),
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: (id: string) =>
      incidentFn({ data: { id, resolution: note.trim() || "Resolved by operations" } }),
    onSuccess: invalidate,
  });
  const reviewBrand = useMutation({
    mutationFn: (data: { id: string; decision: "approved" | "rejected" }) => reviewTrustedBrandFn({ data }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-trusted-brands"] }),
  });

  if (board.isPending) {
    return (
      <AppShell title="Operations" eyebrow="Twende Ops">
      {detail ? <AdminSubjectDetail kind={detail.kind} id={detail.id} onClose={() => setDetail(null)} /> : null}
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading the board…</p>
      </AppShell>
    );
  }
  if (board.error) {
    return (
      <AppShell title="Operations" eyebrow="Twende Ops">
        <p className="px-4 py-6 text-sm text-destructive">{(board.error as Error).message}</p>
      </AppShell>
    );
  }

  const b = board.data!;
  const who = (id: string | null) => {
    const p = b.applicants.find((a) => a.id === id);
    return p ? (p.full_name ?? p.email ?? id) : (id ?? "unknown");
  };

  return (
    <AppShell title="Operations" eyebrow="Twende Ops">
      <div className="hero-gradient px-4 pb-8 pt-5">
        <div className="mx-auto max-w-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-foreground/70">Twende operations command centre</p>
          <h2 className="mt-2 font-display text-2xl font-extrabold text-brand-foreground">Keep every trip, car and document moving</h2>
          <p className="mt-1 max-w-xl text-sm text-brand-foreground/75">Start with the items that need a decision, then use the registers below to inspect people, cars, payments and incidents.</p>
        </div>
        <div className="mx-auto mt-4 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Requested 24h", value: b.last24h.requested },
            { label: "Completed 24h", value: b.last24h.completed },
            { label: "No driver", value: b.last24h.noDriver },
            { label: "Gross KES", value: b.last24h.gross.toFixed(0) },
          ].map((stat) => (
            <section key={stat.label} className="glass p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-foreground/70">
                {stat.label}
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-brand-foreground">
                {stat.value}
              </p>
            </section>
          ))}
        </div>
      </div>

      <section className="mx-auto max-w-2xl px-4 pt-4">
        <div className="surface-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Admin workspace</p>
          <p className="mt-1 text-sm text-muted-foreground">Open every admin area from one place. Your role controls which tools are available.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["/admin/unattended", "Unattended"],
              ["/admin/support", "Claims"],
              ["/admin/whatsapp", "WhatsApp"],
              ["/admin/finance", "Finance"],
              ["/admin/hire", "Hire"],
              ["/admin/pricing", "Pricing"],
              ["/admin/staff", "People"],
              ["/admin/documents", "Documents"],
            ] as const).map(([to, label]) => (
              <Link key={to} to={to} className="rounded-xl border border-border bg-secondary/50 px-3 py-3 text-center text-xs font-semibold text-foreground hover:border-primary/40">
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <PartnerInterestRequestsBoard />
        <WalletPayoutsBoard />
        <ApproachFeeSettingsCard />
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Trusted brand requests ({trustedBrands.data?.length ?? 0})</h3>
          <p className="mt-1 text-xs text-muted-foreground">Owners must confirm permission from a brand. Approve only requests that can be supported if the brand asks.</p>
          {trustedBrands.data?.length ? <ul className="mt-3 divide-y divide-border">{trustedBrands.data.map((request: { id: string; brand_name: string; owner_user_id: string; owner?: { full_name?: string | null; email?: string | null } | null }) => <li key={request.id} className="py-3"><p className="text-sm font-semibold text-foreground">{request.brand_name}</p><p className="text-xs text-muted-foreground">Owner: {request.owner?.full_name ?? request.owner?.email ?? request.owner_user_id}</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => reviewBrand.mutate({ id: request.id, decision: "approved" })} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Approve</button><button type="button" onClick={() => reviewBrand.mutate({ id: request.id, decision: "rejected" })} className="rounded-full border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive">Reject</button></div></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">No trusted-brand requests are waiting.</p>}
        </section>
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Review note</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Attached to the next approval, rejection, cancellation or resolution you record.
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={400}
            placeholder="Reason or verification note"
            className="mt-2 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
          />
        </section>

        {/* Driver applications */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Driver applications ({b.pendingDrivers.length})
          </h3>
          {b.pendingDrivers.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No driver applications awaiting review.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.pendingDrivers.map((d) => (
                <li key={d.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">{who(d.id)}</p>
                  <p className="text-xs text-muted-foreground">
                    Applied {new Date(d.created_at).toLocaleString("en-KE")}
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) => review.mutate({ kind: "driver", id: d.id, decision })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Vehicles */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Vehicles ({b.pendingVehicles.length})
          </h3>
          {b.pendingVehicles.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No vehicles awaiting review.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.pendingVehicles.map((v) => (
                <li key={v.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">
                    {v.plate_number} · {v.vehicle_class}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[v.colour, v.make, v.model, v.year].filter(Boolean).join(" ")} ·{" "}
                    {who(v.owner_driver_id)}
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) => review.mutate({ kind: "vehicle", id: v.id, decision })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Delivery rate proposals awaiting review ({b.pendingDeliveryRates.length})
          </h3>
          {b.pendingDeliveryRates.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No company rate proposals awaiting review.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.pendingDeliveryRates.map((proposal) => (
                <li key={proposal.id} className="py-3">
                  <p className="text-sm font-semibold text-foreground">{proposal.business_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Proposed: KES {Number(proposal.base_fee).toFixed(2)} base +{" "}
                    {Number(proposal.per_km).toFixed(2)}/km +{" "}
                    {Number(proposal.per_minute).toFixed(2)}/min; minimum KES{" "}
                    {Number(proposal.minimum_fee).toFixed(2)}.
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Submitted {new Date(proposal.submitted_at).toLocaleString("en-KE")}
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) =>
                      review.mutate({ kind: "delivery_rate", id: proposal.id, decision })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Ops inspects hire listing details and photos separately from road-use registration. */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Hire vehicles awaiting inspection ({b.pendingHireVehicles.length})
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Inspect the physical car and verify its photos, features, description, and hire price
            before approving the public listing.
          </p>
          {b.pendingHireVehicles.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No hire vehicles awaiting inspection.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.pendingHireVehicles.map((vehicle) => (
                <li key={vehicle.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">
                    {vehicle.plate_number} · KES {Number(vehicle.hire_daily_rate ?? 0).toFixed(2)} /
                    day
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[vehicle.make, vehicle.model, vehicle.colour].filter(Boolean).join(" ")} ·{" "}
                    {vehicle.hire_mode} · owner {who(vehicle.owner_driver_id)}
                  </p>
                  {vehicle.hire_description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{vehicle.hire_description}</p>
                  ) : null}
                  {vehicle.hire_features ? (
                    <p className="mt-1 text-xs text-foreground">
                      Listed features: {vehicle.hire_features}
                    </p>
                  ) : null}
                  {vehicle.review_photo_links.length ? (
                    <div className="mt-2 flex gap-2 overflow-x-auto">
                      {vehicle.review_photo_links.map((src, index) => (
                        <img
                          key={`${vehicle.id}-${index}`}
                          src={src}
                          alt={`${vehicle.plate_number} hire listing photo ${index + 1}`}
                          className="h-16 w-24 shrink-0 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-warning-foreground">
                      No photo could be loaded for review.
                    </p>
                  )}
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) =>
                      review.mutate({ kind: "hire_vehicle", id: vehicle.id, decision })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Documents */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Documents ({b.pendingDocuments.length})
          </h3>
          {b.pendingDocuments.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No documents awaiting verification.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.pendingDocuments.map((doc) => (
                <li key={doc.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">
                    {b.documentTypes.find((t) => t.id === doc.document_type_id)?.label ??
                      "Document"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {doc.reference ?? "no reference"} · {who(doc.subject_user_id)}
                    {doc.expires_on ? ` · expires ${doc.expires_on}` : ""}
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) =>
                      review.mutate({ kind: "document", id: doc.id, decision })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Fleets */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Fleets ({b.allFleets.length})</h3>
          {b.allFleets.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No fleet businesses registered yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.allFleets.map((fleet) => (
                <li key={fleet.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">{fleet.business_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {fleet.status} · owner {who(fleet.owner_id)} ·{" "}
                    {b.allVehicles.filter((v) => v.fleet_id === fleet.id).length} vehicles
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) =>
                      review.mutate({ kind: "fleet", id: fleet.id, decision })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Driver register */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            All drivers ({b.allDrivers.length})
          </h3>
          {b.allDrivers.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No drivers registered yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.allDrivers.map((driver) => (
                <li key={driver.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => setDetail({ kind: "driver", id: driver.id })} className="text-left text-sm font-medium text-foreground underline-offset-2 hover:underline">{who(driver.id)}</button>
                    <StatusPill status={driver.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {driver.status} · {driver.is_online ? "online" : "offline"} ·{" "}
                    {driver.completed_rides} trips · rating {Number(driver.rating ?? 5).toFixed(1)}
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) =>
                      review.mutate({ kind: "driver", id: driver.id, decision })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Vehicle register */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            All vehicles ({b.allVehicles.length})
          </h3>
          {b.allVehicles.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No vehicles registered yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.allVehicles.map((vehicle) => (
                <li key={vehicle.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => setDetail({ kind: "vehicle", id: vehicle.id })} className="text-left text-sm font-medium text-foreground underline-offset-2 hover:underline">
                      {vehicle.plate_number} · {vehicle.vehicle_class === "boda" || vehicle.vehicle_class === "e_boda" ? "🏍 " : ""}{vehicle.vehicle_class}
                    </button>
                    <StatusPill status={vehicle.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {vehicle.status} ·{" "}
                    {[vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
                      "no details"}
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) =>
                      review.mutate({ kind: "vehicle", id: vehicle.id, decision })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Live rides */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Live rides ({b.activeRides.length}) · online drivers {b.onlineDrivers.length}
          </h3>
          {b.activeRides.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nothing in flight right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.activeRides.map((ride) => (
                <li key={ride.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">
                    {ride.reference} · KES {Number(ride.total_fare).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ride.status} · {ride.payment_method} · {ride.payment_status}
                  </p>
                  <button
                    onClick={() => cancelRide.mutate(ride.id)}
                    disabled={cancelRide.isPending}
                    className="mt-2 rounded-full border border-destructive px-3.5 py-1.5 text-xs font-medium text-destructive disabled:opacity-60"
                  >
                    Cancel ride
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Incidents */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Open incidents ({b.incidents.length})
          </h3>
          {b.incidents.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No open incidents.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.incidents.map((incident) => (
                <li key={incident.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">{incident.category}</p>
                  <p className="text-xs text-muted-foreground">{incident.description}</p>
                  <button
                    onClick={() => resolve.mutate(incident.id)}
                    disabled={resolve.isPending}
                    className="mt-2 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    Mark resolved
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(review.isError || cancelRide.isError || resolve.isError) && (
          <p className="text-xs text-destructive">
            {((review.error ?? cancelRide.error ?? resolve.error) as Error).message}
          </p>
        )}
      </div>
    </AppShell>
  );
}

function Decisions({
  disabled,
  onDecide,
}: {
  disabled: boolean;
  onDecide: (decision: "approved" | "rejected" | "restricted") => void;
}) {
  return (
    <div className="mt-2 flex gap-2">
      <button
        onClick={() => onDecide("approved")}
        disabled={disabled}
        className="flex-1 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
      >
        Approve
      </button>
      <button
        onClick={() => onDecide("restricted")}
        disabled={disabled}
        className="rounded-full border border-input px-3 py-2 text-xs font-medium text-muted-foreground disabled:opacity-60"
      >
        Restrict
      </button>
      <button
        onClick={() => onDecide("rejected")}
        disabled={disabled}
        className="rounded-full border border-destructive px-3 py-2 text-xs font-medium text-destructive disabled:opacity-60"
      >
        Reject
      </button>
    </div>
  );
}

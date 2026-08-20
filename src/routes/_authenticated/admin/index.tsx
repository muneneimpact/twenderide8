import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, adminTabs } from "@/components/AppShell";
import { getOpsBoard, opsCancelRide, resolveIncident, reviewApproval } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Operations board — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Twende Ride operations: approve driver applications, vehicles and documents, monitor live rides and resolve incidents in Meru.",
      },
      { property: "og:title", content: "Twende Ride operations board" },
      { property: "og:description", content: "Approve drivers, watch live dispatch and resolve incidents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminBoard,
});

function AdminBoard() {
  const queryClient = useQueryClient();
  const fetchBoard = useServerFn(getOpsBoard);
  const reviewFn = useServerFn(reviewApproval);
  const cancelFn = useServerFn(opsCancelRide);
  const incidentFn = useServerFn(resolveIncident);

  const board = useQuery({ queryKey: ["ops-board"], queryFn: () => fetchBoard({}), refetchInterval: 20000 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["ops-board"] });
  const [note, setNote] = useState("");

  const review = useMutation({
    mutationFn: (vars: {
      kind: "driver" | "vehicle" | "fleet" | "document";
      id: string;
      decision: "approved" | "rejected" | "restricted";
    }) => reviewFn({ data: { ...vars, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => {
      setNote("");
      invalidate();
    },
  });
  const cancelRide = useMutation({
    mutationFn: (rideId: string) => cancelFn({ data: { rideId, reason: note.trim() || "Cancelled by operations" } }),
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: (id: string) =>
      incidentFn({ data: { id, resolution: note.trim() || "Resolved by operations" } }),
    onSuccess: invalidate,
  });

  if (board.isPending) {
    return (
      <AppShell title="Operations" tabs={adminTabs} eyebrow="Twende Ops">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading the board…</p>
      </AppShell>
    );
  }
  if (board.error) {
    return (
      <AppShell title="Operations" tabs={adminTabs} eyebrow="Twende Ops">
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
    <AppShell title="Operations" tabs={adminTabs} eyebrow="Twende Ops">
      <div className="hero-gradient px-4 pb-8 pt-5">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
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
              <p className="mt-1 font-display text-lg font-semibold text-brand-foreground">{stat.value}</p>
            </section>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
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
          <h3 className="text-sm font-semibold text-foreground">Driver applications ({b.pendingDrivers.length})</h3>
          {b.pendingDrivers.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No driver applications awaiting review.</p>
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
          <h3 className="text-sm font-semibold text-foreground">Vehicles ({b.pendingVehicles.length})</h3>
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
                    {[v.colour, v.make, v.model, v.year].filter(Boolean).join(" ")} · {who(v.owner_driver_id)}
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

        {/* Documents */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Documents ({b.pendingDocuments.length})</h3>
          {b.pendingDocuments.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No documents awaiting verification.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {b.pendingDocuments.map((doc) => (
                <li key={doc.id} className="py-3">
                  <p className="text-sm font-medium text-foreground">
                    {b.documentTypes.find((t) => t.id === doc.document_type_id)?.label ?? "Document"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {doc.reference ?? "no reference"} · {who(doc.subject_user_id)}
                    {doc.expires_on ? ` · expires ${doc.expires_on}` : ""}
                  </p>
                  <Decisions
                    disabled={review.isPending}
                    onDecide={(decision) => review.mutate({ kind: "document", id: doc.id, decision })}
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
          <h3 className="text-sm font-semibold text-foreground">Open incidents ({b.incidents.length})</h3>
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

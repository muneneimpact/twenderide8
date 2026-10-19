import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAdminSubjectDetail } from "@/lib/vehicle-team.functions";
import { CarBadge } from "@/components/CarBadge";

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "bg-primary text-primary-foreground"
      : status === "pending"
        ? "bg-gold text-gold-foreground"
        : "bg-destructive text-destructive-foreground";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {status === "approved" ? "✓ Approved" : status}
    </span>
  );
}

/** Full credentials for a driver or vehicle: people, vehicles and every document. */
export function AdminSubjectDetail({ kind, id, onClose }: { kind: "driver" | "vehicle"; id: string; onClose: () => void }) {
  const fetchDetail = useServerFn(getAdminSubjectDetail);
  const q = useQuery({ queryKey: ["admin-subject", kind, id], queryFn: () => fetchDetail({ data: { kind, id } }) });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-foreground">{kind === "driver" ? "Driver details" : "Vehicle details"}</h3>
          <button onClick={onClose} className="text-sm font-semibold text-muted-foreground">Close</button>
        </div>
        {q.isPending ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : null}
        {q.error ? <p className="mt-4 text-sm text-destructive">{(q.error as Error).message}</p> : null}
        {q.data ? (
          <div className="mt-4 space-y-5">
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Drivers</h4>
              {q.data.people.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No driver linked.</p> : null}
              {q.data.people.map((p) => (
                <div key={p.id} className="mt-2 rounded-2xl border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{p.full_name ?? "Unnamed"}</span>
                    {p.driver ? <StatusPill status={p.driver.status} /> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{[p.phone, p.email].filter(Boolean).join(" · ")}</p>
                  {p.driver ? (
                    <p className="text-xs text-muted-foreground">
                      {p.driver.completed_rides} trips · rating {Number(p.driver.rating ?? 5).toFixed(1)} · {p.driver.is_online ? "online" : "offline"}
                    </p>
                  ) : null}
                </div>
              ))}
            </section>
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vehicles</h4>
              {q.data.vehicles.map((v) => (
                <div key={v.id} className="mt-2 flex items-center justify-between gap-2 rounded-2xl border border-border p-3">
                  <CarBadge colour={v.colour} plate={v.plate_number} vehicleClass={v.vehicle_class}
                    detail={[v.make, v.model, v.year, v.seats ? `${v.seats} seats` : null].filter(Boolean).join(" · ")} />
                  <StatusPill status={v.status} />
                </div>
              ))}
            </section>
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Compliance documents</h4>
              {q.data.documents.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Nothing uploaded yet.</p> : null}
              <ul className="mt-2 space-y-2">
                {q.data.documents.map((d) => (
                  <li key={d.id} className="rounded-2xl border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {d.label}
                        {d.subject_vehicle_id ? ` · ${q.data!.vehicles.find((v) => v.id === d.subject_vehicle_id)?.plate_number ?? "vehicle"}` : ""}
                      </span>
                      <StatusPill status={d.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[d.reference ? `Ref ${d.reference}` : null, d.expires_on ? `Expires ${d.expires_on}` : null].filter(Boolean).join(" · ")}
                    </p>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-primary">Open file</a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

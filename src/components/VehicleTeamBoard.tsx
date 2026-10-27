import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { assignDriverToVehicle, getMyVehicleTeam, onboardDriverForVehicle, revokeDriverFromVehicle } from "@/lib/vehicle-team.functions";
import { CarBadge } from "@/components/CarBadge";

/** Owners assign drivers to their vehicles and follow what each driver has handled. */
export function VehicleTeamBoard() {
  const qc = useQueryClient();
  const fetchTeam = useServerFn(getMyVehicleTeam);
  const assignFn = useServerFn(assignDriverToVehicle);
  const revokeFn = useServerFn(revokeDriverFromVehicle);
  const team = useQuery({ queryKey: ["vehicle-team"], queryFn: () => fetchTeam() });
  const [phone, setPhone] = useState<Record<string, string>>({});
  const assign = useMutation({
    mutationFn: (vehicleId: string) => assignFn({ data: { vehicleId, phone: phone[vehicleId] ?? "" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle-team"] }),
  });
  const onboardFn = useServerFn(onboardDriverForVehicle);
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [newPhone, setNewPhone] = useState<Record<string, string>>({});
  const onboard = useMutation({
    mutationFn: (vehicleId: string) =>
      onboardFn({ data: { vehicleId, fullName: newName[vehicleId] ?? "", phone: newPhone[vehicleId] ?? "" } }),
    onSuccess: (_r, vehicleId) => {
      setNewName({ ...newName, [vehicleId]: "" });
      setNewPhone({ ...newPhone, [vehicleId]: "" });
      qc.invalidateQueries({ queryKey: ["vehicle-team"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (assignmentId: string) => revokeFn({ data: { assignmentId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicle-team"] }),
  });
  if (!team.data || team.data.vehicles.length === 0) return null;

  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Drivers for your cars</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Add a driver for any car that will be used with a driver. They receive requests for the car
        you assign, and you can see their approvals and trip history here. Their ID, certificate of
        good conduct and driving licence stay on their own driver profile for review.
      </p>
      <div className="mt-3 space-y-4">
        {team.data.vehicles.map((v) => {
          const rows = team.data!.assignments.filter((a) => a.vehicle_id === v.id);
          return (
            <div key={v.id} className="rounded-2xl border border-border p-3">
              <CarBadge colour={v.colour} plate={v.plate_number} vehicleClass={v.vehicle_class}
                detail={[v.make, v.model].filter(Boolean).join(" ") || v.vehicle_class} />
              {rows.map((a) => (
                <div key={a.id} className="mt-3 rounded-xl bg-muted p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{a.name}{a.phone ? ` · ${a.phone}` : ""}</p>
                    <button onClick={() => revoke.mutate(a.id)} className="text-xs font-semibold text-destructive">Remove</button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.completed} trips done · KES {a.earned.toFixed(0)} total (KES {a.cash.toFixed(0)} cash) · {a.cancelled} cancelled
                  </p>
                  <p className="mt-1 text-xs font-semibold text-foreground">
                    {a.approval === "approved" ? "Approved to drive" : "Waiting for Twende approval"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {a.docs.map((d) => (
                      <span key={d.label} className={`rounded-full px-2 py-0.5 text-[11px] ${d.status === "approved" ? "bg-primary/15 text-primary" : d.status === "rejected" ? "bg-destructive/15 text-destructive" : "bg-background text-muted-foreground"}`}>
                        {d.label}: {d.status === "missing" ? "not sent" : d.status}
                      </span>
                    ))}
                  </div>
                  {a.recent.length ? (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                      {a.recent.map((r) => (
                        <li key={r.id}>{r.reference} · {r.status.replace(/_/g, " ")} · KES {Number(r.total_fare ?? 0).toFixed(0)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              <div className="mt-3 flex gap-2">
                <input value={phone[v.id] ?? ""} onChange={(e) => setPhone({ ...phone, [v.id]: e.target.value })}
                  placeholder="Driver phone e.g. 0712 345678" inputMode="tel"
                  className="min-w-0 flex-1 rounded-2xl border border-input bg-background px-3 py-2 text-sm" />
                <button onClick={() => assign.mutate(v.id)} disabled={assign.isPending}
                  className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">Assign</button>
              </div>
              <div className="mt-3 rounded-xl border border-dashed border-border p-3">
                <p className="text-xs font-semibold text-foreground">Onboard a new driver for this vehicle</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  They sign in with this phone number, upload their ID, certificate of good conduct and driving licence, and can drive once Twende approves. They only see this vehicle.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input value={newName[v.id] ?? ""} onChange={(e) => setNewName({ ...newName, [v.id]: e.target.value })}
                    placeholder="Full name" className="min-w-0 rounded-2xl border border-input bg-background px-3 py-2 text-sm" />
                  <input value={newPhone[v.id] ?? ""} onChange={(e) => setNewPhone({ ...newPhone, [v.id]: e.target.value })}
                    placeholder="Phone e.g. 0712 345678" inputMode="tel" className="min-w-0 rounded-2xl border border-input bg-background px-3 py-2 text-sm" />
                  <button onClick={() => onboard.mutate(v.id)} disabled={onboard.isPending}
                    className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
                    {onboard.isPending ? "Adding…" : "Onboard"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {onboard.isError ? <p className="text-xs text-destructive">{(onboard.error as Error).message}</p> : null}
        {onboard.isSuccess ? <p className="text-xs text-primary">Driver added. We've texted them a sign-in link.</p> : null}
        {assign.isError ? <p className="text-xs text-destructive">{(assign.error as Error).message}</p> : null}
      </div>
    </section>
  );
}

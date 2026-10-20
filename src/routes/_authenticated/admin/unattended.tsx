import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getUnattendedRides, getUnattendedResolutions, opsCancelRide, resolveUnattendedRide, RESOLUTION_STAGES, listDriversForManualDispatch, manualDispatchToDriver } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/unattended")({
  head: () => ({
    meta: [
      { title: "Unattended rides — Twende Meru Rides" },
      { name: "description", content: "Review unattended ride requests in Twende Meru Rides." },
      { property: "og:title", content: "Unattended rides — Twende Meru Rides" },
      { property: "og:description", content: "Review unattended ride requests in Twende Meru Rides." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UnattendedPage,
});

const LABEL: Record<string, string> = {
  no_driver_found: "No driver found",
  expired: "Expired",
  searching: "Still searching",
};

function UnattendedPage() {
  const [days, setDays] = useState(7);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["unattended", days],
    queryFn: () => getUnattendedRides({ data: { days } }),
    refetchInterval: 30000,
  });
  const ids = (q.data ?? []).map((r) => r.id);
  const res = useQuery({ queryKey: ["unattended-res", ids], queryFn: () => getUnattendedResolutions({ data: { rideIds: ids } }), enabled: ids.length > 0 });
  const [filter, setFilter] = useState<"all" | "paid" | "open" | "done">("all");
  const isDone = (id: string) => ["resolved", "refunded", "driver_assigned", "rebooked", "customer_cancelled"].includes(res.data?.[id]?.history[0]?.stage ?? "");
  const isPaid = (id: string) => ["paid", "refund_pending"].includes(res.data?.[id]?.payment_status ?? "");
  const shown = (q.data ?? []).filter((r) => filter === "all" || (filter === "paid" ? isPaid(r.id) : filter === "done" ? isDone(r.id) : !isDone(r.id)));
  const close = async (id: string) => {
    try {
      await opsCancelRide({ data: { rideId: id, reason: "Closed by operations: no driver available" } });
      toast.success("Request closed");
      qc.invalidateQueries({ queryKey: ["unattended"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Unattended requests</h1>
        <div className="flex gap-1">
          {[1, 7, 30].map((d) => (
            <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>
              {d === 1 ? "Today" : `${d} days`}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {([["all", "All"], ["paid", "Paid – check refund"], ["open", "Unresolved"], ["done", "Resolved"]] as const).map(([k, l]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{l}</Button>
        ))}
      </div>
      {q.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {q.error && (
        <div className="rounded-lg border border-destructive p-3 text-sm">
          Couldn't load: {(q.error as Error).message}{" "}
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <p className="rounded-lg border p-6 text-center text-muted-foreground">Every request in this period got a driver. 🎉</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((r) => (
          <div key={r.id} className="space-y-1 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{r.dropoff ?? r.reference}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{LABEL[r.status] ?? r.status}</span>
            </div>
            <p className="text-sm text-muted-foreground">From: {r.pickup ?? "—"}</p>
            {r.pickup_lat != null && r.pickup_lng != null ? (
              <a className="inline-flex text-xs font-semibold text-primary underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${r.pickup_lat},${r.pickup_lng}`}>
                View pickup on map
              </a>
            ) : null}
            <p className="text-sm">
              {r.customer_name ?? "Customer"} {r.customer_phone && <a className="underline" href={`tel:${r.customer_phone}`}>{r.customer_phone}</a>}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(r.requested_at).toLocaleString()} · KES {Number(r.total_fare).toLocaleString()} · {r.payment_method}
            </p>
            {r.status === "searching" && (
              <Button size="sm" variant="outline" onClick={() => close(r.id)}>Close request</Button>
            )}
            <ManualDispatch rideId={r.id} onDone={() => qc.invalidateQueries({ queryKey: ["unattended"] })} />
            <Resolution rideId={r.id} info={res.data?.[r.id]} onDone={() => qc.invalidateQueries({ queryKey: ["unattended-res"] })} />
          </div>
        ))}
      </div>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  investigating: "Investigating",
  driver_assigned: "Driver assigned manually",
  rebooked: "Rebooked",
  customer_cancelled: "Customer cancelled / no trip",
  refund_needed: "Paid – refund needed",
  refunded: "Refund sent",
  resolved: "Resolved",
};

type ResInfo = { payment_status: string; paid: number; mpesa: string | null; refund: { amount: number; status: string } | null; history: { stage: string; note: string; at: string }[] };

function Resolution({ rideId, info, onDone }: { rideId: string; info: ResInfo | undefined; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<(typeof RESOLUTION_STAGES)[number]>("investigating");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const paid = info && ["paid", "refund_pending", "refunded"].includes(info.payment_status);
  const latest = info?.history[0];
  const save = async () => {
    setBusy(true);
    try {
      await resolveUnattendedRide({ data: { rideId, stage, note, notifyCustomer: notify } });
      toast.success("Resolution saved");
      setOpen(false);
      setNote("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 space-y-2 border-t pt-2 text-xs">
      <div className="flex flex-wrap gap-1">
        {paid ? <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">Paid KES {info!.paid.toLocaleString()}{info!.mpesa ? ` · ${info!.mpesa}` : ""}</span> : <span className="rounded-full bg-muted px-2 py-0.5">Not paid</span>}
        {info?.refund ? <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">Refund {info.refund.status}</span> : paid && info?.payment_status === "paid" ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-semibold text-destructive">Refund may be needed</span> : null}
        {latest ? <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success">{STAGE_LABEL[latest.stage] ?? latest.stage}</span> : <span className="rounded-full bg-muted px-2 py-0.5">Unresolved</span>}
      </div>
      {paid ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-2">
          <p className="font-semibold text-foreground">Refund</p>
          <p className="text-muted-foreground">
            Paid KES {info!.paid.toLocaleString()}{info!.mpesa ? ` · M-PESA ${info!.mpesa}` : ""}.{" "}
            {info!.refund ? `Refund KES ${info!.refund.amount.toLocaleString()} is ${info!.refund.status}.` : "No refund recorded yet."}
          </p>
          {!info!.refund || info!.refund.status !== "completed" ? (
            <div className="mt-1 flex gap-1">
              {!info!.refund ? <Button size="sm" variant="outline" onClick={() => { setStage("refund_needed"); setOpen(true); }}>Start refund</Button> : null}
              {info!.refund ? <Button size="sm" variant="outline" onClick={() => { setStage("refunded"); setOpen(true); }}>Mark refund sent</Button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {info?.history.length ? (
        <ul className="space-y-0.5 text-muted-foreground">
          {info.history.slice(0, 3).map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} — {STAGE_LABEL[h.stage] ?? h.stage}{h.note ? `: ${h.note}` : ""}</li>)}
        </ul>
      ) : null}
      {open ? (
        <div className="space-y-2">
          <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} className="input-base w-full">
            {RESOLUTION_STAGES.filter((s) => paid || (s !== "refund_needed" && s !== "refunded")).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What was done / resolution notes" className="input-base w-full" />
          <label className="flex items-center gap-2"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Text the customer an update</label>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save resolution"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Resolve / update stage</Button>
      )}
    </div>
  );
}

function ManualDispatch({ rideId, onDone }: { rideId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const drivers = useQuery({ queryKey: ["manual-drivers", rideId], queryFn: () => listDriversForManualDispatch({ data: { rideId } }), enabled: open });
  const chosen = drivers.data?.find((d) => d.id === pick);
  const send = async () => {
    setBusy(true);
    try {
      await manualDispatchToDriver({ data: { rideId, driverId: pick } });
      toast.success("Request sent. It shows in the driver's app to accept.");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Call &amp; send to a driver</Button>;
  return (
    <div className="space-y-2 rounded-lg border p-2 text-xs">
      <p className="font-semibold">1. Call a driver · 2. Pick them · 3. Send. They accept in their app.</p>
      {drivers.isLoading ? <p className="text-muted-foreground">Loading drivers…</p> : null}
      <select value={pick} onChange={(e) => setPick(e.target.value)} className="input-base w-full">
        <option value="">Choose driver</option>
        {(drivers.data ?? []).map((d) => (
          <option key={d.id} value={d.id} disabled={!d.has_vehicle}>
            {d.name} · {d.online ? "online" : "offline"}{d.km != null ? ` · ${d.km} km` : ""}{d.has_vehicle ? "" : " · no vehicle"}
          </option>
        ))}
      </select>
      {chosen?.phone ? <a className="inline-flex font-semibold text-primary underline" href={`tel:${chosen.phone}`}>Call {chosen.name} ({chosen.phone})</a> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={send} disabled={!pick || busy}>{busy ? "Sending…" : "Send ride to driver"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

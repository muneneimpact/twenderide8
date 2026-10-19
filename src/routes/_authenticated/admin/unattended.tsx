import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getUnattendedRides, opsCancelRide } from "@/lib/admin.functions";
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
        {q.data?.map((r) => (
          <div key={r.id} className="space-y-1 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{r.dropoff ?? r.reference}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{LABEL[r.status] ?? r.status}</span>
            </div>
            <p className="text-sm text-muted-foreground">From: {r.pickup ?? "—"}</p>
            <p className="text-sm">
              {r.customer_name ?? "Customer"} {r.customer_phone && <a className="underline" href={`tel:${r.customer_phone}`}>{r.customer_phone}</a>}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(r.requested_at).toLocaleString()} · KES {Number(r.total_fare).toLocaleString()} · {r.payment_method}
            </p>
            {r.status === "searching" && (
              <Button size="sm" variant="outline" onClick={() => close(r.id)}>Close request</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

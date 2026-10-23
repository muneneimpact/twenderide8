import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { listMyRides } from "@/lib/rides.functions";
import { ReceiptDownload } from "@/components/ReceiptDownload";

export const Route = createFileRoute("/_authenticated/rides/")({
  head: () => ({
    meta: [
      { title: "My rides — Twende Meru Rides" },
      {
        name: "description",
        content: "Every Twende Meru Rides trip you have taken in Meru, with the fare charged and its payment status.",
      },
      { property: "og:title", content: "My rides — Twende Meru Rides" },
      { property: "og:description", content: "Your Twende Meru Rides trip history and payment status." },
    ],
  }),
  component: RidesPage,
});

const statusLabels: Record<string, string> = {
  searching: "Finding a driver",
  driver_assigned: "Driver on the way",
  driver_arrived: "Driver arrived",
  trip_started: "On trip",
  trip_completed: "Completed",
  cancelled_by_customer: "Cancelled by you",
  cancelled_by_driver: "Cancelled by driver",
  cancelled_by_ops: "Cancelled by operations",
  no_driver_found: "No driver found",
};

function RidesPage() {
  const fetchRides = useServerFn(listMyRides);
  const { data, isPending, error } = useQuery({
    queryKey: ["my-rides"],
    queryFn: () => fetchRides({ data: undefined }),
  });

  return (
    <AppShell title="My rides">
      <div className="mx-auto max-w-md px-4 py-4">
        {isPending && <p className="text-sm text-muted-foreground">Loading your rides…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && data.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-foreground">You haven't taken a ride yet.</p>
            <Link
              to="/book"
              className="mt-3 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Book your first taxi
            </Link>
          </div>
        )}
        <ul className="space-y-2">
          {(data ?? []).map((ride) => (
            <li key={ride.id}>
              <Link
                to="/rides/$rideId"
                params={{ rideId: ride.id }}
                className="block rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {ride.trip_name ?? ride.reference}
                  </span>
                  <span className="text-sm text-foreground">KES {Number(ride.total_fare).toFixed(2)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ride.reference} · {statusLabels[ride.status] ?? ride.status} ·{" "}
                  {new Date(ride.requested_at).toLocaleString("en-KE")}
                </p>
              </Link>
              {ride.status === "trip_completed" ? (
                <ReceiptDownload
                  kind="ride"
                  id={ride.id}
                  className="mt-1 text-xs font-semibold text-primary disabled:opacity-50"
                />
              ) : null}
            </li>
          ))}
        </ul>
        <Link
          to="/book"
          className="mt-6 block rounded-full bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground"
        >
          Book another ride
        </Link>

      </div>
    </AppShell>
  );
}

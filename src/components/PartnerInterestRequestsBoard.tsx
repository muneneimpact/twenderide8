import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Car } from "lucide-react";
import {
  listPartnerInterestRequests,
  reviewPartnerInterest,
} from "@/lib/partner-interest.functions";

type RequestRow = Awaited<ReturnType<typeof listPartnerInterestRequests>>[number];

export function PartnerInterestRequestsBoard() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listPartnerInterestRequests);
  const reviewFn = useServerFn(reviewPartnerInterest);
  const requests = useQuery({
    queryKey: ["ops-partner-interest"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });
  const review = useMutation({
    mutationFn: (data: { id: string; status: RequestRow["status"] }) => reviewFn({ data }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ops-partner-interest"] }),
  });
  const rows = requests.data ?? [];
  return (
    <section className="surface-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Drive or list interest</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Lightweight public applications. Collect vehicle details and compliance only after
            approval.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {rows.filter((r) => r.status === "new").length} new
        </span>
      </div>
      {requests.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading interest requests…</p>
      ) : null}
      {!requests.isPending && rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No driver or car-owner interest yet.</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {rows.map((row) => {
          const isDriver = row.request_type === "driver";
          return (
            <article key={row.id} className="rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {isDriver ? (
                    <Bike className="h-4 w-4 text-primary" />
                  ) : (
                    <Car className="h-4 w-4 text-sky" />
                  )}
                  {row.full_name}
                </p>
                <span className="rounded-full bg-secondary px-2 py-1 text-[11px] capitalize text-foreground">
                  {row.status === "approved"
                    ? "Approved for onboarding"
                    : row.status === "closed"
                      ? "Closed — onboarding completed"
                      : row.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-foreground">
                {row.phone} · {row.town} · best time: {row.best_time}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isDriver
                  ? `${row.preferred_work_type?.replace("_", " / ")} · owns vehicle: ${row.owns_vehicle ? "yes" : "no"} · licence/PSV: ${row.licence_psv_status || "not stated"}`
                  : `${row.number_of_cars == null ? "Not stated" : row.number_of_cars >= 11 ? "10+" : row.number_of_cars} car(s) to list`}
              </p>
              {row.note ? (
                <p className="mt-2 whitespace-pre-line rounded-xl bg-secondary/50 p-2 text-xs text-foreground">
                  {row.note}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {row.status !== "closed" &&
                  (["contacted", "approved", "declined"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => review.mutate({ id: row.id, status })}
                      disabled={review.isPending}
                      className="rounded-full border border-input px-3 py-2 text-xs font-semibold capitalize text-foreground disabled:opacity-50"
                    >
                      {status === "approved" ? "Approved for onboarding" : status}
                    </button>
                  ))}
                {row.status === "approved" ? (
                  <Link
                    to="/auth"
                    search={{
                      redirect: isDriver ? "/driver/apply" : "/driver/hire?section=vehicles",
                      mode: isDriver ? "signup" : undefined,
                    }}
                    className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    Open onboarding
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

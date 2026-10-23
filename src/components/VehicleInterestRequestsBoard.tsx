import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listVehicleInterestRequests,
  updateVehicleInterestRequest,
} from "@/lib/vehicle-interest.functions";

type RequestRow = Awaited<ReturnType<typeof listVehicleInterestRequests>>[number];

export function VehicleInterestRequestsBoard() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listVehicleInterestRequests);
  const updateFn = useServerFn(updateVehicleInterestRequest);
  const requests = useQuery({
    queryKey: ["admin-vehicle-interest-requests"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (data: { id: string; status: RequestRow["status"]; response?: string }) =>
      updateFn({ data }),
    onSuccess: () => {
      setNotice("Interest request updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-vehicle-interest-requests"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const rows = requests.data ?? [];
  return (
    <section className="surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Vehicle interest requests</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Visitors who ask AI for a car can leave their trip needs and contact details here. Reply
            with availability, alternatives or a follow-up question.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {rows.filter((row) => row.status === "new").length} new
        </span>
      </div>
      {requests.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading interest requests…</p>
      ) : null}
      {!requests.isPending && rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No vehicle interest requests yet.</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {rows.map((row) => {
          const response = drafts[row.id] ?? row.admin_response ?? "";
          return (
            <article key={row.id} className="rounded-2xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{row.contact_name}</p>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs capitalize text-foreground">
                  {row.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {new Date(row.created_at).toLocaleString("en-KE")} ·{" "}
                {row.contact_phone || row.contact_email}
              </p>
              <p className="mt-3 whitespace-pre-line rounded-xl bg-secondary/50 p-3 text-sm text-foreground">
                {row.trip_needs}
              </p>
              {row.recommended_vehicle_ids.length ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  AI viewed {row.recommended_vehicle_ids.length} catalogue match(es):{" "}
                  {row.recommended_vehicle_ids.join(", ")}
                </p>
              ) : null}
              <textarea
                value={response}
                onChange={(event) => setDrafts({ ...drafts, [row.id]: event.target.value })}
                maxLength={2000}
                rows={3}
                placeholder="Reply, e.g. We have a 7-seater available from Friday. Please confirm your pickup time."
                className="input-base mt-3 w-full"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {(["in_progress", "responded", "closed"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => update.mutate({ id: row.id, status, response })}
                    disabled={update.isPending || (status === "responded" && !response.trim())}
                    className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50"
                  >
                    {status === "in_progress"
                      ? "Mark in progress"
                      : status === "responded"
                        ? "Send response"
                        : "Close request"}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {notice ? <p className="mt-2 text-xs text-muted-foreground">{notice}</p> : null}
    </section>
  );
}

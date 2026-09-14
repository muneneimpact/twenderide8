import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listHireRequestsForProvider, makeHireOffer } from "@/lib/hire.functions";

/**
 * Hire requests a driver or owner can take on, with the price they want to
 * charge. The customer can turn an offer down and someone else can step in.
 */
export function HireRequestsBoard() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listHireRequestsForProvider);
  const offerFn = useServerFn(makeHireOffer);
  const board = useQuery({ queryKey: ["hire-provider-board"], queryFn: () => listFn() });
  const [drafts, setDrafts] = useState<Record<string, { vehicleId: string; price: string; note: string }>>(
    {},
  );
  const [notice, setNotice] = useState<string | null>(null);

  const offer = useMutation({
    mutationFn: (vars: { quoteId: string; vehicleId: string; price: number; note?: string }) =>
      offerFn({ data: vars }),
    onSuccess: () => {
      setNotice("Offer sent to the customer.");
      queryClient.invalidateQueries({ queryKey: ["hire-provider-board"] });
    },
    onError: (error) => setNotice((error as Error).message),
  });

  const vehicles = board.data?.vehicles ?? [];
  const requests = board.data?.requests ?? [];

  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Hire requests</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Customers looking for a vehicle like yours. Send your price and they choose.
      </p>

      {board.isPending ? <p className="mt-3 text-xs text-muted-foreground">Loading…</p> : null}
      {!board.isPending && requests.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No hire requests for your vehicles yet.</p>
      ) : null}

      <div className="mt-3 space-y-3">
        {requests.map((request) => {
          const stops = Array.isArray(request.stops) ? (request.stops as { label?: string }[]) : [];
          const draft = drafts[request.id] ?? {
            vehicleId: vehicles[0]?.id ?? "",
            price: String(Number(request.estimated_total) || 0),
            note: "",
          };
          const mine = request.my_offer;
          return (
            <article key={request.id} className="rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{request.reference}</p>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                  {request.drive_mode === "self_drive" ? "Self drive" : "With driver"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(request.start_at).toLocaleString("en-KE")} · {request.days} day(s) ·{" "}
                {request.vehicle_class} · {request.passengers} pax
              </p>
              {request.pickup_label ? (
                <p className="mt-1 text-xs text-foreground">Collect from: {request.pickup_label}</p>
              ) : null}
              {stops.length ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {stops.map((stop) => stop.label).filter(Boolean).join(" → ")}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                Customer estimate KES {Number(request.estimated_total).toLocaleString("en-KE")}
              </p>

              {mine ? (
                <p className="mt-2 text-xs font-medium text-foreground">
                  Your offer: KES {Number(mine.price).toLocaleString("en-KE")} ({mine.status})
                </p>
              ) : null}

              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <select
                  value={draft.vehicleId}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [request.id]: { ...draft, vehicleId: event.target.value } })
                  }
                  className="input-base"
                >
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate_number} · {vehicle.vehicle_class}
                    </option>
                  ))}
                </select>
                <input
                  value={draft.price}
                  inputMode="decimal"
                  placeholder="Your price (KES)"
                  onChange={(event) =>
                    setDrafts({ ...drafts, [request.id]: { ...draft, price: event.target.value } })
                  }
                  className="input-base"
                />
                <input
                  value={draft.note}
                  placeholder="Note to the customer"
                  onChange={(event) =>
                    setDrafts({ ...drafts, [request.id]: { ...draft, note: event.target.value } })
                  }
                  className="input-base"
                />
              </div>

              <button
                onClick={() =>
                  offer.mutate({
                    quoteId: request.id,
                    vehicleId: draft.vehicleId,
                    price: Number(draft.price) || 0,
                    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
                  })
                }
                disabled={offer.isPending || !draft.vehicleId}
                className="mt-2 w-full rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {mine ? "Update my offer" : "Send offer"}
              </button>
            </article>
          );
        })}
      </div>
      {notice ? <p className="mt-2 text-xs text-muted-foreground">{notice}</p> : null}
    </section>
  );
}

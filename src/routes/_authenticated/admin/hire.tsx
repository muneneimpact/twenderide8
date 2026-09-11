import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { decideHireQuote, listHireQuotes } from "@/lib/hire.functions";

export const Route = createFileRoute("/_authenticated/admin/hire")({
  head: () => ({
    meta: [
      { title: "Hire and corporate quotations | Twende Meru Rides" },
      {
        name: "description",
        content: "Review corporate booking and car hire requests, set the final price and confirm them.",
      },
      { property: "og:title", content: "Hire and corporate quotations | Twende Meru Rides" },
      { property: "og:description", content: "Ops queue for corporate bookings and car hire requests." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminHirePage,
});

function AdminHirePage() {
  return (
    <RoleGate allow={["ops_admin", "super_admin"]} title="Hire requests">
      <AdminHireBoard />
    </RoleGate>
  );
}

function AdminHireBoard() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listHireQuotes);
  const decideFn = useServerFn(decideHireQuote);
  const quotes = useQuery({ queryKey: ["admin-hire-quotes"], queryFn: () => listFn() });
  const [drafts, setDrafts] = useState<Record<string, { price: string; note: string }>>({});

  const decide = useMutation({
    mutationFn: (vars: {
      id: string;
      status: "quoted" | "confirmed" | "declined";
      quotedTotal?: number | null;
      adminNotes?: string | undefined;
    }) => decideFn({ data: vars }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-hire-quotes"] }),
  });

  return (
    <AppShell title="Hire requests">
      <div className="space-y-3 pb-24">
        {(quotes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No hire or corporate requests yet.</p>
        ) : null}
        {(quotes.data ?? []).map((quote) => {
          const draft = drafts[quote.id] ?? {
            price: quote.quoted_total == null ? String(Number(quote.estimated_total)) : String(Number(quote.quoted_total)),
            note: quote.admin_notes ?? "",
          };
          const stops = Array.isArray(quote.stops) ? (quote.stops as { label?: string }[]) : [];
          return (
            <section key={quote.id} className="surface-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{quote.reference}</p>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                  {quote.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {quote.organisation ?? "Individual"} · {new Date(quote.start_at).toLocaleString("en-KE")} ·{" "}
                {quote.days} day(s) · {quote.vehicle_class} ·{" "}
                {quote.drive_mode === "self_drive" ? "Self drive" : "With driver"} · {quote.passengers} pax
              </p>
              {stops.length ? (
                <p className="mt-1 text-xs text-foreground">
                  {stops.map((stop) => stop.label).filter(Boolean).join(" → ")}
                </p>
              ) : null}
              {quote.notes ? <p className="mt-1 text-xs text-muted-foreground">{quote.notes}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Estimate KES {Number(quote.estimated_total).toLocaleString("en-KE")}
              </p>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input
                  value={draft.price}
                  onChange={(e) => setDrafts({ ...drafts, [quote.id]: { ...draft, price: e.target.value } })}
                  inputMode="decimal"
                  placeholder="Final price (KES)"
                  className="input-base"
                />
                <input
                  value={draft.note}
                  onChange={(e) => setDrafts({ ...drafts, [quote.id]: { ...draft, note: e.target.value } })}
                  placeholder="Note to the customer"
                  className="input-base"
                />
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {(["quoted", "confirmed", "declined"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() =>
                      decide.mutate({
                        id: quote.id,
                        status,
                        quotedTotal: status === "declined" ? null : Number(draft.price) || 0,
                        adminNotes: draft.note.trim() || undefined,
                      })
                    }
                    disabled={decide.isPending}
                    className="rounded-full border border-input px-3 py-2 text-xs font-medium text-foreground disabled:opacity-60"
                  >
                    {status === "quoted" ? "Send quotation" : status === "confirmed" ? "Confirm" : "Decline"}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}

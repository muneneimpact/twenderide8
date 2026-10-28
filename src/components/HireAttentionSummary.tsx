import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listHireRequestsForProvider } from "@/lib/hire.functions";
import { listOwnerBookings } from "@/lib/hire-owner.functions";

export function HireAttentionSummary() {
  const bookingsFn = useServerFn(listOwnerBookings);
  const requestsFn = useServerFn(listHireRequestsForProvider);
  const bookings = useQuery({
    queryKey: ["owner-hire-bookings"],
    queryFn: () => bookingsFn(),
    refetchInterval: 30_000,
  });
  const requests = useQuery({
    queryKey: ["hire-provider-board"],
    queryFn: () => requestsFn(),
    refetchInterval: 15_000,
  });
  const bookingCount = (bookings.data ?? []).filter((item) => {
    const lifecycle = item.lifecycle_state;
    if (["closed", "declined", "cancelled"].includes(lifecycle)) return false;
    if (["on_hire", "return_pending"].includes(lifecycle))
      return Boolean(item.end_at && new Date(item.end_at).getTime() <= Date.now());
    if (lifecycle === "settlement_pending") return true;
    if (lifecycle === "submitted" && item.pay_later && !item.company_verified) return true;
    if (!["ready_for_handover", "confirmed"].includes(lifecycle)) return false;
    if (item.deposit_policy === "handover" && item.deposit_amount > 0) {
      if (!item.deposit_requested) return true;
      if (item.paid < item.total) return false;
    }
    return true;
  }).length;
  const requestCount = (requests.data?.requests ?? []).filter((item) => {
    const fixed = Boolean(item.vehicle_id && item.payment_policy !== "legacy");
    if (fixed)
      return (
        item.payment_status === "partial" &&
        Number(item.payment_paid_total ?? 0) < Number(item.quoted_total ?? item.estimated_total)
      );
    return ["submitted", "quoted"].includes(item.status) && (!item.my_offer || Number((item.my_offer as { counter_price?: number | null }).counter_price ?? 0) > 0);
  }).length;
  const total = bookingCount + requestCount;

  return (
    <section
      className="surface-card border-2 border-warning/40 bg-warning/5 p-4"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-foreground">Needs your attention</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {bookings.isPending || requests.isPending
              ? "Checking current items…"
              : total
                ? `${total} booking or request${total === 1 ? "" : "s"} currently need${total === 1 ? "s" : ""} your action.`
                : "No current bookings or quote requests need action."}
          </p>
        </div>
        <span className="rounded-full bg-warning px-3 py-1.5 text-sm font-extrabold text-warning-foreground">
          {bookings.isPending || requests.isPending ? "…" : total}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href="#owner-bookings"
          className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
        >
          Bookings ({bookings.isPending ? "…" : bookingCount})
        </a>
        <a
          href="#hire-requests"
          className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
        >
          Quote requests ({requests.isPending ? "…" : requestCount})
        </a>
      </div>
      {bookings.error || requests.error ? (
        <p className="mt-2 text-xs text-destructive">
          {(bookings.error ?? (requests.error as Error))?.message ??
            "Could not refresh the attention count."}
        </p>
      ) : null}
    </section>
  );
}

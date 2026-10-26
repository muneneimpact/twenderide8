import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listHireOwnerInquiries, updateHireOwnerInquiry } from "@/lib/hire-marketing.functions";

function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
}

export function HireInquiriesBoard() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listHireOwnerInquiries);
  const updateFn = useServerFn(updateHireOwnerInquiry);
  const inquiries = useQuery({ queryKey: ["hire-owner-inquiries"], queryFn: () => listFn() });
  const update = useMutation({
    mutationFn: (input: { id: string; status: "new" | "contacted" | "closed" }) =>
      updateFn({ data: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["hire-owner-inquiries"] }),
  });
  const rows = inquiries.data ?? [];
  return (
    <section className="surface-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Incoming inquiries</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Questions from visitors to your public hire page.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
          {rows.filter((row) => row.status === "new").length} new
        </span>
      </div>
      {inquiries.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Loading inquiries…</p>
      ) : null}
      {inquiries.isError ? (
        <p className="mt-4 text-xs text-destructive">
          Could not load inquiries: {(inquiries.error as Error).message}
        </p>
      ) : null}
      {!inquiries.isPending && !inquiries.isError && rows.length === 0 ? (
        <p className="mt-4 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          No inquiries yet. Share your public hire link to start receiving questions.
        </p>
      ) : null}
      <div className="mt-3 space-y-3">
        {rows.map((row) => {
          const vehicle = Array.isArray(row.vehicles) ? row.vehicles[0] : row.vehicles;
          const vehicleName = vehicle
            ? [vehicle.make, vehicle.model].filter(Boolean).join(" ")
            : "Any car";
          return (
            <article key={row.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{row.customer_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {vehicleName} · {row.service_type.replace("_", " ")}
                    {row.dates_note ? ` · ${row.dates_note}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold capitalize text-foreground">
                  {row.status}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                {row.message}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`tel:${row.customer_phone}`}
                  className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-foreground"
                >
                  Call
                </a>
                <a
                  href={`https://wa.me/${whatsappNumber(row.customer_phone)}?text=${encodeURIComponent(`Hi ${row.customer_name}, thanks for your inquiry about ${vehicleName}.`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  WhatsApp
                </a>
                {row.status === "new" ? (
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: row.id, status: "contacted" })}
                    className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    Mark contacted
                  </button>
                ) : null}
                {row.status !== "closed" ? (
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: row.id, status: "closed" })}
                    className="rounded-full border border-input px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                  >
                    Close
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

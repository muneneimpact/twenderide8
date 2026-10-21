import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listRatingsForStaff } from "@/lib/ratings.functions";

export function RatingsBoard() {
  const fn = useServerFn(listRatingsForStaff);
  const [onlyComments, setOnly] = useState(true);
  const q = useQuery({ queryKey: ["staff-ratings", onlyComments], queryFn: () => fn({ data: { onlyWithComments: onlyComments } }) });
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Trip ratings & comments</h2>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={onlyComments} onChange={(e) => setOnly(e.target.checked)} /> With comments only</label>
      </div>
      {q.isError && <p className="mt-2 text-sm text-destructive">{(q.error as Error).message}</p>}
      <ul className="mt-2 space-y-2">
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{"★".repeat(r.score)}{"☆".repeat(5 - r.score)} · {r.trip}</span>
              <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-KE")}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.rater} rated {r.about} {r.ratee}{r.driverAverage != null ? ` · driver average ${r.driverAverage.toFixed(2)}` : ""}
            </p>
            {r.comment ? <p className="mt-1 text-foreground">“{r.comment}”</p> : null}
          </li>
        ))}
        {q.isSuccess && !q.data.length ? <li className="text-sm text-muted-foreground">No ratings yet.</li> : null}
      </ul>
    </section>
  );
}

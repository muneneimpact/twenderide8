import { useState } from "react";

export type PeriodRow = { amount: number; at: string };
type Period = "day" | "week" | "month" | "custom";

export function periodStart(period: Exclude<Period, "custom">, now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === "month") d.setDate(1);
  return d;
}

export function sumInPeriod(rows: PeriodRow[], from: Date, to = new Date()): number {
  const a = from.getTime(), b = to.getTime();
  return rows.reduce((s, r) => {
    const t = new Date(r.at).getTime();
    return t >= a && t <= b ? s + r.amount : s;
  }, 0);
}

const money = (v: number) => `KES ${v.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

/** Shows Today / This week / This month side by side, with an optional custom range filter. */
export function PeriodSummary({
  title,
  series,
  highlight,
}: {
  title: string;
  series: { label: string; rows: PeriodRow[] }[];
  highlight?: string;
}) {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const cols: { key: string; label: string; from: Date; to?: Date }[] = custom && from && to
    ? [{ key: "custom", label: `${from} → ${to}`, from: new Date(from), to: new Date(`${to}T23:59:59`) }]
    : [
        { key: "day", label: "Today", from: periodStart("day") },
        { key: "week", label: "This week", from: periodStart("week") },
        { key: "month", label: "This month", from: periodStart("month") },
      ];
  return (
    <section className="surface-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button
          type="button"
          onClick={() => setCustom((v) => !v)}
          className="rounded-full border border-input px-3 py-1 text-[11px] font-semibold text-muted-foreground"
        >
          {custom ? "Show day · week · month" : "Filter dates"}
        </button>
      </div>
      {custom ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base" aria-label="From" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base" aria-label="To" />
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {series.map((s) => {
          const strong = s.label === highlight;
          return (
            <div key={s.label} className={`rounded-2xl p-3 ${strong ? "border-2 border-primary bg-primary/10" : "border border-border"}`}>
              <p className={`text-[11px] uppercase tracking-wide ${strong ? "font-bold text-primary" : "font-semibold text-muted-foreground"}`}>{s.label}</p>
              <div className={`mt-1 grid gap-2 ${cols.length === 1 ? "grid-cols-1" : "grid-cols-3"}`}>
                {cols.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <p className="truncate text-[10px] text-muted-foreground">{c.label}</p>
                    <p className={`truncate ${strong ? "text-base font-extrabold text-foreground" : "text-sm font-semibold text-foreground"}`}>
                      {money(sumInPeriod(s.rows, c.from, c.to))}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

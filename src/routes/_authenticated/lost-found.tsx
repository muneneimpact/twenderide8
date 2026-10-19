import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  createLostFoundReport,
  listDriverCases,
  listMyLostFound,
  listMyRecentTrips,
  postDriverCaseMessage,
  type LostFoundView,
} from "@/lib/lost-found.functions";

export const Route = createFileRoute("/_authenticated/lost-found")({
  head: () => ({
    meta: [
      { title: "Lost & found — Twende Meru Rides" },
      { name: "description", content: "Report an item lost on a trip, or an item found in your car." },
      { property: "og:title", content: "Lost & found — Twende Meru Rides" },
      { property: "og:description", content: "Report lost or found items on Twende trips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LostFoundPage,
});

function ReportCard({ r }: { r: LostFoundView }) {
  return (
    <li className="rounded-xl border border-border p-3 text-xs">
      <div className="flex justify-between gap-2">
        <span className="font-semibold text-foreground">
          {r.kind === "lost" ? "Lost item" : "Found item"} · {r.reporter_name}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 capitalize">{r.status}</span>
      </div>
      <p className="mt-1 text-foreground">{r.description}</p>
      <p className="mt-1 text-muted-foreground">
        Trips: {r.trips.map((t) => t.label).join(" · ") || "—"}
      </p>
    </li>
  );
}

function LostFoundPage() {
  const qc = useQueryClient();
  const { has } = useMe();
  const isDriver = has("driver");
  const [asRaw, setAs] = useState<"customer" | "driver">("customer");
  const as = isDriver ? asRaw : "customer";
  const [picked, setPicked] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const tripsFn = useServerFn(listMyRecentTrips);
  const listFn = useServerFn(listMyLostFound);
  const createFn = useServerFn(createLostFoundReport);
  const casesFn = useServerFn(listDriverCases);
  const replyFn = useServerFn(postDriverCaseMessage);

  const trips = useQuery({ queryKey: ["lf-trips", as], queryFn: () => tripsFn({ data: { as } }) });
  const reports = useQuery({ queryKey: ["lf-mine"], queryFn: () => listFn() });
  const cases = useQuery({ queryKey: ["driver-cases"], queryFn: () => casesFn() });
  const [reply, setReply] = useState<Record<string, string>>({});

  const submit = useMutation({
    mutationFn: () => createFn({ data: { as, rideIds: picked, description } }),
    onSuccess: () => {
      setMsg("Report sent. Our team will match it and contact you.");
      setPicked([]);
      setDescription("");
      void qc.invalidateQueries({ queryKey: ["lf-mine"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const sendReply = useMutation({
    mutationFn: (caseId: string) => replyFn({ data: { caseId, body: reply[caseId] ?? "" } }),
    onSuccess: (_d, caseId) => {
      setReply((r) => ({ ...r, [caseId]: "" }));
      void qc.invalidateQueries({ queryKey: ["driver-cases"] });
    },
  });

  function toggle(id: string) {
    if (as === "customer") setPicked([id]);
    else setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  return (
    <AppShell title="Lost & found">
      <div className="space-y-4 pb-24">
        <section className="surface-card p-4">
          {isDriver ? <div className="flex gap-2">
            {(
              [
                { key: "customer", label: "I lost something" },
                { key: "driver", label: "I found something (driver)" },
              ] as const
            ).map((o) => (
              <button
                key={o.key}
                onClick={() => {
                  setAs(o.key);
                  setPicked([]);
                }}
                className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                  as === o.key ? "bg-primary text-primary-foreground" : "border border-border bg-secondary text-secondary-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div> : <h2 className="text-sm font-semibold text-foreground">Report something you lost</h2>}
          <p className="mt-3 text-xs text-muted-foreground">
            {as === "customer"
              ? "Pick the trip, then describe the item clearly (type, colour, brand, what was inside) so the driver can verify it is yours."
              : "Not sure which ride? Select every trip it could be from."}
          </p>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {(trips.data ?? []).map((t) => (
              <li key={t.id}>
                <label className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
                  <input
                    type={as === "customer" ? "radio" : "checkbox"}
                    checked={picked.includes(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <span className="flex-1 font-medium text-foreground">{t.label}</span>
                  <span className="text-muted-foreground">{new Date(t.when).toLocaleDateString("en-KE")}</span>
                </label>
              </li>
            ))}
            {trips.isSuccess && !trips.data.length ? (
              <li className="text-xs text-muted-foreground">No recent trips.</li>
            ) : null}
          </ul>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={as === "customer" ? "e.g. Black Samsung phone in a red case" : "e.g. A phone was left on the back seat"}
            className="input-base mt-3 w-full"
          />
          <button
            onClick={() => submit.mutate()}
            disabled={!picked.length || description.trim().length < 10 || submit.isPending}
            className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Send report
          </button>
          {msg ? <p className="mt-2 text-xs text-muted-foreground">{msg}</p> : null}
        </section>

        {reports.data?.toVerify.length ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-base font-bold text-foreground">Customers looking for items from your trips</h2>
            <p className="text-xs text-muted-foreground">Compare their description with what you found.</p>
            <ul className="mt-2 space-y-2">{reports.data.toVerify.map((r) => <ReportCard key={r.id} r={r} />)}</ul>
          </section>
        ) : null}

        <section className="surface-card p-4">
          <h2 className="font-display text-base font-bold text-foreground">Your reports</h2>
          <ul className="mt-2 space-y-2">
            {(reports.data?.mine ?? []).map((r) => <ReportCard key={r.id} r={r} />)}
            {reports.isSuccess && !reports.data.mine.length ? (
              <li className="text-xs text-muted-foreground">No reports yet.</li>
            ) : null}
          </ul>
        </section>

        {cases.data?.length ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-base font-bold text-foreground">Complaints you were added to</h2>
            {cases.data.map((c) => (
              <div key={c.id} className="mt-3 rounded-xl border border-border p-3 text-xs">
                <p className="font-semibold text-foreground">{c.subject} · <span className="capitalize">{c.status}</span></p>
                <ul className="mt-2 space-y-1">
                  {c.messages.map((m) => (
                    <li key={m.id}><span className="font-medium capitalize">{m.sender_role}:</span> {m.body}</li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <input
                    value={reply[c.id] ?? ""}
                    onChange={(e) => setReply((r) => ({ ...r, [c.id]: e.target.value }))}
                    placeholder="Your response"
                    className="input-base flex-1"
                  />
                  <button
                    onClick={() => sendReply.mutate(c.id)}
                    disabled={!(reply[c.id] ?? "").trim()}
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

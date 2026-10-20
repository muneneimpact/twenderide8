import { useMe } from "@/hooks/useMe";
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
  listFoundForMe,
  submitFoundClaim,
  listClaimsOnMyFinds,
  decideFoundClaim,
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
  const { has, me } = useMe();
  const isDriver = has("driver") && me?.driver?.status === "approved";
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
  const foundFn = useServerFn(listFoundForMe);
  const claimFn = useServerFn(submitFoundClaim);
  const myClaimsFn = useServerFn(listClaimsOnMyFinds);
  const decideFn = useServerFn(decideFoundClaim);
  const found = useQuery({ queryKey: ["lf-found-for-me"], queryFn: () => foundFn() });
  const claimsOnFinds = useQuery({ queryKey: ["lf-claims-on-finds"], queryFn: () => myClaimsFn(), enabled: isDriver });
  const [claimForm, setClaimForm] = useState<Record<string, { d: string; phone: string; sec: string }>>({});
  const [decNote, setDecNote] = useState<Record<string, string>>({});
  const claim = useMutation({
    mutationFn: (f: { reportId: string; rideId: string }) => {
      const v = claimForm[f.reportId] ?? { d: "", phone: "", sec: "" };
      return claimFn({ data: { ...f, description: v.d, contactPhone: v.phone || undefined, securityDetails: v.sec || undefined } });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lf-found-for-me"] }),
    onError: (e) => setMsg((e as Error).message),
  });
  const decide = useMutation({
    mutationFn: (v: { claimId: string; decision: "approved" | "rejected" | "more_info" }) => decideFn({ data: { ...v, note: decNote[v.claimId] || undefined } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lf-claims-on-finds"] }),
  });

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
              <li className="text-xs text-muted-foreground">No completed trips yet. Only finished trips can be reported.</li>
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

        {isDriver && reports.data?.toVerify.length ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-base font-bold text-foreground">Customers looking for items from your trips</h2>
            <p className="text-xs text-muted-foreground">Compare their description with what you found.</p>
            <ul className="mt-2 space-y-2">{reports.data.toVerify.map((r) => <ReportCard key={r.id} r={r} />)}</ul>
          </section>
        ) : null}

        {found.data?.length ? (
          <section className="surface-card border-2 border-primary/40 p-4">
            <h2 className="font-display text-base font-bold text-foreground">Your driver found something that may be yours</h2>
            <p className="text-xs text-muted-foreground">Describe the item in your own words so the driver can confirm it is yours.</p>
            <ul className="mt-3 space-y-3">
              {found.data.map((f) => {
                const v = claimForm[f.id] ?? { d: "", phone: "", sec: "" };
                const set = (k: "d" | "phone" | "sec", val: string) => setClaimForm((c) => ({ ...c, [f.id]: { ...v, [k]: val } }));
                return (
                  <li key={f.id} className="rounded-xl border border-border p-3 text-xs">
                    <p className="font-semibold text-foreground">Trip: {f.trip?.label ?? "Your trip"} · {f.trip ? new Date(f.trip.when).toLocaleDateString("en-KE") : ""}</p>
                    {f.claim && f.claim.status !== "more_info" ? (
                      <p className="mt-1 capitalize text-muted-foreground">Claim {f.claim.status}{f.claim.driver_note ? ` — ${f.claim.driver_note}` : ""}</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {f.claim?.status === "more_info" ? <p className="text-warning">Driver asked for more details{f.claim.driver_note ? `: ${f.claim.driver_note}` : ""}</p> : null}
                        <textarea value={v.d} onChange={(e) => set("d", e.target.value)} rows={3} className="input-base w-full" placeholder="What is it? Type, colour, brand, what was inside, any marks" />
                        <input value={v.phone} onChange={(e) => set("phone", e.target.value)} className="input-base w-full" placeholder="If it is a phone: its number, so the driver can call it" />
                        <input value={v.sec} onChange={(e) => set("sec", e.target.value)} className="input-base w-full" placeholder="Other proof: case, wallpaper, stickers, IMEI ending…" />
                        <p className="rounded-lg bg-warning/10 p-2 text-[11px] text-foreground">Never type your lock-screen PIN or password. You will unlock the phone in person when you collect it.</p>
                        <button onClick={() => claim.mutate({ reportId: f.id, rideId: f.ride_id })} disabled={v.d.trim().length < 10 || claim.isPending} className="w-full rounded-full bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">Claim</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {isDriver && claimsOnFinds.data?.length ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-base font-bold text-foreground">Claims on items you found</h2>
            <p className="text-xs text-muted-foreground">Compare with the item. Ask them to unlock phones in front of you at handover.</p>
            <ul className="mt-2 space-y-2">
              {claimsOnFinds.data.map((c) => (
                <li key={c.id} className="rounded-xl border border-border p-3 text-xs">
                  <p className="font-semibold text-foreground">{c.claimant} · {c.trip ?? ""} · <span className="capitalize">{c.status.replace("_", " ")}</span></p>
                  <p className="mt-1 text-muted-foreground">You logged: {c.your_item}</p>
                  <p className="mt-1 text-foreground">They say: {c.description}</p>
                  {c.contact_phone ? <p className="mt-1">Phone to call: <a className="underline" href={`tel:${c.contact_phone}`}>{c.contact_phone}</a></p> : null}
                  {c.security_details ? <p className="mt-1">Proof: {c.security_details}</p> : null}
                  {c.status === "pending" ? (
                    <div className="mt-2 space-y-2">
                      <input value={decNote[c.id] ?? ""} onChange={(e) => setDecNote((n) => ({ ...n, [c.id]: e.target.value }))} className="input-base w-full" placeholder="Note or extra check you need (optional)" />
                      <div className="flex gap-2">
                        <button onClick={() => decide.mutate({ claimId: c.id, decision: "approved" })} className="flex-1 rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground">It matches</button>
                        <button onClick={() => decide.mutate({ claimId: c.id, decision: "more_info" })} className="flex-1 rounded-full border border-border px-3 py-2 font-semibold">Need more</button>
                        <button onClick={() => decide.mutate({ claimId: c.id, decision: "rejected" })} className="flex-1 rounded-full border border-destructive px-3 py-2 font-semibold text-destructive">No match</button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
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

        {isDriver && cases.data?.length ? (
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

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, adminTabs } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";

export const Route = createFileRoute("/_authenticated/admin/support")({
  head: () => ({
    meta: [
      { title: "Claims & support — Twende Meru Ops" },
      {
        name: "description",
        content:
          "The support queue for every claim, with assign, resolve, audit history and realtime replies.",
      },
      { property: "og:title", content: "Claims & support — Twende Meru Rides" },
      { property: "og:description", content: "Ops support queue with audit trail and realtime chat." },
    ],
  }),
  component: () => (
    <RoleGate allow={["ops_admin", "super_admin"]} title="Claims & support">
      <SupportOps />
    </RoleGate>
  ),
});

/* ---------------------------------------------------------------------------
 * FRONTEND-ONLY MOCK DATA
 * TODO(lovable-backend): replace with real server functions returning all
 * support cases / incidents. The UI expects exactly this shape.
 * ------------------------------------------------------------------------- */

type CaseStatus = "open" | "in_progress" | "resolved";

interface MockMessage {
  id: string;
  from: "customer" | "agent";
  author: string;
  body: string;
  created_at: string;
}

interface MockAudit {
  id: string;
  action: string;
  actor: string;
  created_at: string;
}

interface MockCase {
  id: string;
  reporter_name: string;
  reporter_phone: string;
  trip_reference: string | null;
  category: string;
  subject: string;
  description: string;
  status: CaseStatus;
  assigned_agent: string | null;
  created_at: string;
  updated_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  messages: MockMessage[];
  audit: MockAudit[];
}

const now = Date.now();
const hour = 3600_000;
const day = 86400000;

const mockCases: MockCase[] = [
  {
    id: "c1",
    reporter_name: "Wanjiku Njeri",
    reporter_phone: "+254712345678",
    trip_reference: "TR-1031",
    category: "refund",
    subject: "Route too long",
    description: "The driver took a much longer route than the estimate. Requesting a partial refund.",
    status: "open",
    assigned_agent: null,
    created_at: new Date(now - 4 * hour).toISOString(),
    updated_at: new Date(now - 3.5 * hour).toISOString(),
    resolved_by: null,
    resolved_at: null,
    messages: [
      { id: "m1", from: "customer", author: "Wanjiku Njeri", body: "The driver took a much longer route. Can I get a partial refund?", created_at: new Date(now - 4 * hour).toISOString() },
    ],
    audit: [
      { id: "a1", action: "Created", actor: "Wanjiku Njeri", created_at: new Date(now - 4 * hour).toISOString() },
      { id: "a2", action: "Viewed", actor: "System", created_at: new Date(now - 3.5 * hour).toISOString() },
    ],
  },
  {
    id: "c2",
    reporter_name: "Brian Kimathi",
    reporter_phone: "+254720112233",
    trip_reference: "TR-1030",
    category: "payment",
    subject: "M-PESA charged twice",
    description: "I was charged for a ride I cancelled. Please refund.",
    status: "in_progress",
    assigned_agent: "Agent A",
    created_at: new Date(now - 2 * day).toISOString(),
    updated_at: new Date(now - 5 * hour).toISOString(),
    resolved_by: null,
    resolved_at: null,
    messages: [
      { id: "m2", from: "customer", author: "Brian Kimathi", body: "I was charged for a cancelled ride.", created_at: new Date(now - 2 * day).toISOString() },
      { id: "m3", from: "agent", author: "Agent A", body: "Checking with payments — will confirm shortly.", created_at: new Date(now - 1 * day).toISOString() },
    ],
    audit: [
      { id: "a3", action: "Created", actor: "Brian Kimathi", created_at: new Date(now - 2 * day).toISOString() },
      { id: "a4", action: "Assigned", actor: "Agent A", created_at: new Date(now - 1.9 * day).toISOString() },
      { id: "a5", action: "Replied", actor: "Agent A", created_at: new Date(now - 1 * day).toISOString() },
    ],
  },
  {
    id: "c3",
    reporter_name: "Amina Ali",
    reporter_phone: "+254733445566",
    trip_reference: null,
    category: "general",
    subject: "Driver verification code",
    description: "How do I receive my driver verification code?",
    status: "resolved",
    assigned_agent: "Agent B",
    created_at: new Date(now - 4 * day).toISOString(),
    updated_at: new Date(now - 3 * day).toISOString(),
    resolved_by: "Agent B",
    resolved_at: new Date(now - 3 * day).toISOString(),
    messages: [
      { id: "m4", from: "customer", author: "Amina Ali", body: "How do I receive my driver verification code?", created_at: new Date(now - 4 * day).toISOString() },
      { id: "m5", from: "agent", author: "Agent B", body: "It is sent by SMS to your registered number.", created_at: new Date(now - 3.5 * day).toISOString() },
      { id: "m6", from: "customer", author: "Amina Ali", body: "Got it, thank you.", created_at: new Date(now - 3.2 * day).toISOString() },
    ],
    audit: [
      { id: "a6", action: "Created", actor: "Amina Ali", created_at: new Date(now - 4 * day).toISOString() },
      { id: "a7", action: "Assigned", actor: "Agent B", created_at: new Date(now - 3.9 * day).toISOString() },
      { id: "a8", action: "Replied", actor: "Agent B", created_at: new Date(now - 3.5 * day).toISOString() },
      { id: "a9", action: "Resolved", actor: "Agent B", created_at: new Date(now - 3 * day).toISOString() },
    ],
  },
  {
    id: "c4",
    reporter_name: "Faith Muthoni",
    reporter_phone: "+254777889900",
    trip_reference: "TR-1027",
    category: "safety",
    subject: "Left an item in the car",
    description: "I left my bag in the car. The driver's name was John.",
    status: "open",
    assigned_agent: null,
    created_at: new Date(now - 30 * 60000).toISOString(),
    updated_at: new Date(now - 30 * 60000).toISOString(),
    resolved_by: null,
    resolved_at: null,
    messages: [
      { id: "m7", from: "customer", author: "Faith Muthoni", body: "I left my bag in the car.", created_at: new Date(now - 30 * 60000).toISOString() },
    ],
    audit: [{ id: "a10", action: "Created", actor: "Faith Muthoni", created_at: new Date(now - 30 * 60000).toISOString() }],
  },
];

const statusLabel: Record<CaseStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-warning/15 text-warning" },
  in_progress: { label: "In progress", className: "bg-primary/15 text-primary" },
  resolved: { label: "Resolved", className: "bg-success/15 text-success" },
};

function SupportOps() {
  // TODO(lovable-backend): fetch these from a listSupportCases server function.
  const [cases, setCases] = useState<MockCase[]>(mockCases);
  const [filter, setFilter] = useState<"all" | CaseStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(mockCases[0]?.id ?? null);
  const [reply, setReply] = useState("");

  const selected = cases.find((c) => c.id === selectedId) ?? null;

  // TODO(lovable-backend): persist these mutations server-side.
  const setStatus = (id: string, status: CaseStatus, agent?: string) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              status,
              assigned_agent: agent ?? c.assigned_agent,
              resolved_by: status === "resolved" ? (agent ?? c.assigned_agent ?? "You") : null,
              resolved_at: status === "resolved" ? new Date().toISOString() : null,
              updated_at: new Date().toISOString(),
            }
          : c,
      ),
    );
  };

  const assignToMe = (id: string) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, assigned_agent: "You", status: "in_progress", updated_at: new Date().toISOString() }
          : c,
      ),
    );
  };

  const sendReply = (id: string) => {
    const body = reply.trim();
    if (!body) return;
    // TODO(lovable-backend): persist the agent reply and broadcast it via
    // Supabase Realtime so the customer sees it instantly.
    setCases((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              updated_at: new Date().toISOString(),
              messages: [
                ...c.messages,
                { id: crypto.randomUUID(), from: "agent" as const, author: "You", body, created_at: new Date().toISOString() },
              ],
            }
          : c,
      ),
    );
    setReply("");
  };

  const visible = filter === "all" ? cases : cases.filter((c) => c.status === filter);

  return (
    <AppShell title="Claims & support" eyebrow="Twende Ops" tabs={adminTabs}>
      <div className="mx-auto max-w-md px-4 py-5">
        {/* Filter tabs */}
        <div className="flex gap-1.5 overflow-x-auto">
          {(
            [
              { key: "all", label: "All" },
              { key: "open", label: "Open" },
              { key: "in_progress", label: "In progress" },
              { key: "resolved", label: "Resolved" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-semibold ${
                filter === tab.key ? "bg-primary text-primary-foreground" : "border border-input text-muted-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="mt-3 px-1 text-xs text-muted-foreground">
          {visible.length} case{visible.length === 1 ? "" : "s"}
        </p>

        {/* Case list */}
        <div className="mt-2 space-y-2">
          {visible.map((c) => {
            const meta = statusLabel[c.status];
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedId(c.id);
                  setReply("");
                }}
                className={`block w-full rounded-2xl border p-3 text-left ${
                  c.id === selectedId ? "border-primary bg-accent" : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{c.subject}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {c.trip_reference ? `${c.trip_reference} · ` : ""}
                      {c.category} · {c.reporter_name}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${meta.className}`}>
                    {meta.label}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {c.assigned_agent ? `Assigned: ${c.assigned_agent}` : "Unassigned"} · Updated{" "}
                  {new Date(c.updated_at).toLocaleTimeString("en-KE")}
                </p>
              </button>
            );
          })}
          {visible.length === 0 ? <p className="text-xs text-muted-foreground">No cases in this view.</p> : null}
        </div>

        {/* Detail panel */}
        {selected ? (
          <section className="surface-card mt-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-foreground">{selected.subject}</h3>
                <p className="text-xs text-muted-foreground">
                  {selected.trip_reference ? `${selected.trip_reference} · ` : ""}
                  {selected.category}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusLabel[selected.status].className}`}>
                {statusLabel[selected.status].label}
              </span>
            </div>

            {/* Reporter contact — tappable to call / SMS / WhatsApp. */}
            <div className="mt-3 rounded-2xl border border-border bg-background px-3 py-2">
              <a href={`tel:${selected.reporter_phone}`} className="text-sm font-semibold text-primary">
                <span className="block truncate">{selected.reporter_name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{selected.reporter_phone}</span>
              </a>
              <div className="mt-2 flex gap-1.5">
                <a href={`tel:${selected.reporter_phone}`} className="rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-white">Call</a>
                <a href={`sms:${selected.reporter_phone}`} className="rounded-full border border-input bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground">SMS</a>
                {/* TODO(lovable-backend): replace with an actual WhatsApp link config. */}
                <a href={`https://wa.me/${selected.reporter_phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="rounded-full border border-input bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground">WhatsApp</a>
              </div>
            </div>

            <p className="mt-3 text-sm text-foreground">{selected.description}</p>

            {/* Conversation */}
            <div className="mt-3 space-y-2">
              {selected.messages.map((m) => (
                <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "agent" ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                  <p>{m.body}</p>
                  <p className="mt-0.5 text-[10px] opacity-70">{m.author} · {new Date(m.created_at).toLocaleTimeString("en-KE")}</p>
                </div>
              ))}
            </div>

            {/* Reply box */}
            {/* TODO(lovable-backend): subscribe to Supabase Realtime on this case
                so the admin sees the customer's live replies here. */}
            <div className="mt-3 flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type a reply…"
                className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={() => sendReply(selected.id)}
                disabled={!reply.trim()}
                className="shrink-0 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Send
              </button>
            </div>

            {/* Actions */}
            <div className="mt-3 flex flex-wrap gap-2">
              {!selected.assigned_agent ? (
                <button onClick={() => assignToMe(selected.id)} className="rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground">Assign to me</button>
              ) : null}
              {selected.status !== "resolved" ? (
                <button
                  onClick={() => setStatus(selected.id, "resolved", selected.assigned_agent ?? "You")}
                  className="rounded-full border border-success bg-success/10 px-3.5 py-2 text-xs font-semibold text-success"
                >
                  Resolve
                </button>
              ) : (
                <button
                  onClick={() => setStatus(selected.id, "open", selected.assigned_agent ?? undefined)}
                  className="rounded-full border border-warning bg-warning/10 px-3.5 py-2 text-xs font-semibold text-warning"
                >
                  Reopen
                </button>
              )}
            </div>

            {/* Audit history */}
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Audit history</h4>
              <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                {selected.audit.map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-3">
                    <span>{entry.action} — {entry.actor}</span>
                    <span>{new Date(entry.created_at).toLocaleString("en-KE")}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell, adminTabs } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { supabase } from "@/integrations/supabase/client";
import {
  assignSupportCase,
  getSupportCaseAudit,
  listSupportCases,
  postSupportMessage,
  setSupportCaseStatus,
} from "@/lib/support.functions";

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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RoleGate allow={["ops_admin", "super_admin"]} title="Claims & support">
      <SupportOps />
    </RoleGate>
  ),
});

type CaseStatus = "open" | "in_progress" | "resolved";

const statusLabel: Record<CaseStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-warning/15 text-warning" },
  in_progress: { label: "In progress", className: "bg-primary/15 text-primary" },
  resolved: { label: "Resolved", className: "bg-success/15 text-success" },
};

function SupportOps() {
  const listFn = useServerFn(listSupportCases);
  const replyFn = useServerFn(postSupportMessage);
  const statusFn = useServerFn(setSupportCaseStatus);
  const assignFn = useServerFn(assignSupportCase);
  const auditFn = useServerFn(getSupportCaseAudit);

  const [filter, setFilter] = useState<"all" | CaseStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const casesQuery = useQuery({ queryKey: ["ops", "support-cases"], queryFn: () => listFn() });
  const cases = casesQuery.data ?? [];
  const selected = cases.find((c) => c.id === selectedId) ?? null;

  const audit = useQuery({
    queryKey: ["ops", "support-audit", selectedId],
    queryFn: () => auditFn({ data: { caseId: selectedId! } }),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!selectedId && cases.length > 0) setSelectedId(cases[0]!.id);
  }, [selectedId, cases]);

  // Live customer replies land in the queue without a manual refresh.
  useEffect(() => {
    const channel = supabase
      .channel("support-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, () => {
        void casesQuery.refetch();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_cases" }, () => {
        void casesQuery.refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendReply = useMutation({
    mutationFn: (caseId: string) => replyFn({ data: { caseId, body: reply.trim() } }),
    onSuccess: () => {
      setReply("");
      void casesQuery.refetch();
    },
  });

  const changeStatus = useMutation({
    mutationFn: (input: { caseId: string; status: CaseStatus }) => statusFn({ data: input }),
    onSuccess: () => {
      void casesQuery.refetch();
      void audit.refetch();
    },
  });

  const assignToMe = useMutation({
    mutationFn: (caseId: string) => assignFn({ data: { caseId } }),
    onSuccess: () => {
      void casesQuery.refetch();
      void audit.refetch();
    },
  });

  const visible = filter === "all" ? cases : cases.filter((c) => c.status === filter);

  return (
    <AppShell title="Claims & support" eyebrow="Twende Ops" tabs={adminTabs}>
      <div className="mx-auto max-w-md px-4 py-5">
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
          {casesQuery.isPending ? "Loading cases…" : `${visible.length} case${visible.length === 1 ? "" : "s"}`}
        </p>

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
          {!casesQuery.isPending && visible.length === 0 ? (
            <p className="text-xs text-muted-foreground">No cases in this view.</p>
          ) : null}
        </div>

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
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusLabel[selected.status].className}`}
              >
                {statusLabel[selected.status].label}
              </span>
            </div>

            {selected.reporter_phone ? (
              <div className="mt-3 rounded-2xl border border-border bg-background px-3 py-2">
                <a href={`tel:${selected.reporter_phone}`} className="text-sm font-semibold text-primary">
                  <span className="block truncate">{selected.reporter_name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {selected.reporter_phone}
                  </span>
                </a>
                <div className="mt-2 flex gap-1.5">
                  <a
                    href={`tel:${selected.reporter_phone}`}
                    className="rounded-full bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground"
                  >
                    Call
                  </a>
                  <a
                    href={`sms:${selected.reporter_phone}`}
                    className="rounded-full border border-input bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground"
                  >
                    SMS
                  </a>
                  <a
                    href={`https://wa.me/${selected.reporter_phone.replace(/[^0-9]/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-input bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground"
                  >
                    WhatsApp
                  </a>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{selected.reporter_name}</p>
            )}

            <div className="mt-3 space-y-2">
              {selected.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "customer" ? "bg-secondary text-secondary-foreground" : "ml-auto bg-primary text-primary-foreground"}`}
                >
                  <p>{m.body}</p>
                  <p className="mt-0.5 text-[10px] opacity-70">
                    {m.author} · {new Date(m.created_at).toLocaleTimeString("en-KE")}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type a reply…"
                className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={() => sendReply.mutate(selected.id)}
                disabled={!reply.trim() || sendReply.isPending}
                className="shrink-0 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {sendReply.isPending ? "Sending…" : "Send"}
              </button>
            </div>
            {sendReply.isError && (
              <p className="mt-2 text-xs text-destructive">{(sendReply.error as Error).message}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {!selected.assigned_to ? (
                <button
                  onClick={() => assignToMe.mutate(selected.id)}
                  disabled={assignToMe.isPending}
                  className="rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Assign to me
                </button>
              ) : null}
              {selected.status !== "resolved" ? (
                <button
                  onClick={() => changeStatus.mutate({ caseId: selected.id, status: "resolved" })}
                  disabled={changeStatus.isPending}
                  className="rounded-full border border-success bg-success/10 px-3.5 py-2 text-xs font-semibold text-success disabled:opacity-60"
                >
                  Resolve
                </button>
              ) : (
                <button
                  onClick={() => changeStatus.mutate({ caseId: selected.id, status: "open" })}
                  disabled={changeStatus.isPending}
                  className="rounded-full border border-warning bg-warning/10 px-3.5 py-2 text-xs font-semibold text-warning disabled:opacity-60"
                >
                  Reopen
                </button>
              )}
            </div>

            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Audit history
              </h4>
              <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li className="flex justify-between gap-3">
                  <span>created — {selected.reporter_name}</span>
                  <span>{new Date(selected.created_at).toLocaleString("en-KE")}</span>
                </li>
                {(audit.data ?? []).map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-3">
                    <span>
                      {entry.action} — {entry.actor}
                    </span>
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

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { listStaffUsers, setUserRole } from "@/lib/admin.functions";

const ROLES = [
  "customer",
  "driver",
  "fleet_owner",
  "ops_admin",
  "finance_admin",
  "super_admin",
] as const;

export const Route = createFileRoute("/_authenticated/admin/staff")({
  head: () => ({
    meta: [
      { title: "Roles & audit trail — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Super admin control over Twende Meru Rides roles: grant or remove operations, finance, fleet and driver access, and read the audit trail of every privileged action.",
      },
      { property: "og:title", content: "Roles & audit trail — Twende Meru Rides" },
      { property: "og:description", content: "Grant roles and review every privileged action." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RoleGate allow={["super_admin"]} title="Roles">
      <StaffBoard />
    </RoleGate>
  ),
});

function StaffBoard() {
  const queryClient = useQueryClient();
  const fetchStaff = useServerFn(listStaffUsers);
  const roleFn = useServerFn(setUserRole);

  const staff = useQuery({ queryKey: ["staff-users"], queryFn: () => fetchStaff({}) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("ops_admin");

  const change = useMutation({
    mutationFn: (grant: boolean) => roleFn({ data: { email: email.trim().toLowerCase(), role, grant } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff-users"] }),
  });

  if (staff.isPending) {
    return (
      <AppShell title="Roles" eyebrow="Twende Super Admin">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading roles…</p>
      </AppShell>
    );
  }
  if (staff.error) {
    return (
      <AppShell title="Roles" eyebrow="Twende Super Admin">
        <p className="px-4 py-6 text-sm text-destructive">{(staff.error as Error).message}</p>
      </AppShell>
    );
  }

  const s = staff.data!;
  const byUser = new Map<string, string[]>();
  for (const row of s.roles) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.role]);
  }

  return (
    <AppShell title="Roles" eyebrow="Twende Super Admin">
      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Grant or remove a role</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The person must already have a Twende Meru Rides account with this email address.
          </p>
          <div className="mt-3 space-y-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="person@example.com"
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
              className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => change.mutate(true)}
                disabled={!email.includes("@") || change.isPending}
                className="flex-1 rounded-full bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Grant
              </button>
              <button
                onClick={() => change.mutate(false)}
                disabled={!email.includes("@") || change.isPending}
                className="flex-1 rounded-full border border-destructive px-3 py-2.5 text-sm font-semibold text-destructive disabled:opacity-60"
              >
                Remove
              </button>
            </div>
            {change.isError ? (
              <p className="text-xs text-destructive">{(change.error as Error).message}</p>
            ) : null}
            {change.isSuccess ? <p className="text-xs text-muted-foreground">Roles updated.</p> : null}
          </div>
        </section>

        <PeopleGroups profiles={s.profiles} byUser={byUser} hireOwners={new Set(s.hireOwnerIds)} driverStatus={s.driverStatus} />

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Audit trail</h3>
          <ul className="mt-2 divide-y divide-border">
            {s.auditLogs.map((log) => (
              <li key={log.id} className="py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{log.action}</span>
                {log.entity_type ? ` · ${log.entity_type}` : ""} ·{" "}
                {new Date(log.created_at).toLocaleString("en-KE")}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  ops_admin: "Ops admin",
  finance_admin: "Finance admin",
  driver: "Driver",
  fleet_owner: "Fleet owner",
  customer: "Customer",
};

type Person = { id: string; full_name: string | null; email: string | null; phone: string | null };

function PeopleGroups({ profiles, byUser, hireOwners, driverStatus }: {
  profiles: Person[]; byUser: Map<string, string[]>; hireOwners: Set<string>; driverStatus: Record<string, string>;
}) {
  const [tab, setTab] = useState<"ops" | "driver" | "hire" | "customer">("ops");
  const [q, setQ] = useState("");
  const roles = (id: string) => byUser.get(id) ?? [];
  const isOps = (id: string) => roles(id).some((r) => r.endsWith("_admin"));
  const groups = {
    ops: profiles.filter((p) => isOps(p.id)),
    driver: profiles.filter((p) => roles(p.id).includes("driver")),
    hire: profiles.filter((p) => hireOwners.has(p.id) || roles(p.id).includes("fleet_owner")),
    customer: profiles.filter((p) => !isOps(p.id) && !roles(p.id).includes("driver") && !hireOwners.has(p.id) && !roles(p.id).includes("fleet_owner")),
  };
  const opsOrder = ["super_admin", "ops_admin", "finance_admin"];
  const term = q.trim().toLowerCase();
  const list = groups[tab]
    .filter((p) => !term || [p.full_name, p.email, p.phone].some((v) => v?.toLowerCase().includes(term)))
    .sort((a, b) => tab === "ops"
      ? Math.min(...roles(a.id).map((r) => opsOrder.indexOf(r)).filter((i) => i >= 0)) - Math.min(...roles(b.id).map((r) => opsOrder.indexOf(r)).filter((i) => i >= 0))
      : 0);
  const tabs = [["ops", "Ops team"], ["driver", "Drivers"], ["hire", "Car hire"], ["customer", "Customers"]] as const;
  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">People</h3>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-2 py-2 text-[11px] font-semibold ${tab === k ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
            {l} ({groups[k].length})
          </button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or phone" className="mt-2 w-full rounded-2xl border border-input bg-background px-3.5 py-2 text-sm" />
      <ul className="mt-2 divide-y divide-border">
        {list.map((p) => (
          <li key={p.id} className="py-2.5">
            <p className="text-sm font-medium text-foreground">{p.full_name ?? p.email ?? p.id}</p>
            <p className="text-xs text-muted-foreground">{p.email ?? "no email"}{p.phone ? ` · ${p.phone}` : ""}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {roles(p.id).filter((r) => tab !== "ops" || r.endsWith("_admin")).map((r) => (
                <span key={r} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r === "super_admin" ? "bg-destructive/15 text-destructive" : r.endsWith("_admin") ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{ROLE_LABEL[r] ?? r}</span>
              ))}
              {tab === "driver" && driverStatus[p.id] ? <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold capitalize text-warning">{driverStatus[p.id]}</span> : null}
              {hireOwners.has(p.id) ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Car hire owner</span> : null}
            </div>
          </li>
        ))}
        {!list.length ? <li className="py-3 text-xs text-muted-foreground">Nobody here yet.</li> : null}
      </ul>
    </section>
  );
}

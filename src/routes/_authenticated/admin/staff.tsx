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
      { title: "Roles & audit trail — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Super admin control over Twende Ride roles: grant or remove operations, finance, fleet and driver access, and read the audit trail of every privileged action.",
      },
      { property: "og:title", content: "Roles & audit trail — Twende Ride" },
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
            The person must already have a Twende Ride account with this email address.
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

        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">People with roles</h3>
          <ul className="mt-2 divide-y divide-border">
            {s.profiles.map((profile) => (
              <li key={profile.id} className="py-2.5">
                <p className="text-sm font-medium text-foreground">
                  {profile.full_name ?? profile.email ?? profile.id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {profile.email ?? "no email"} · {(byUser.get(profile.id) ?? []).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>

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

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { useMe, type AppRole } from "@/hooks/useMe";

/**
 * Client-side role gate. The server functions behind every screen re-check the
 * role, so this only decides what is worth rendering.
 */
export function RoleGate({
  allow,
  title,
  children,
  hint,
  actionTo,
  actionLabel,
}: {
  allow: AppRole[];
  title: string;
  children: ReactNode;
  hint?: string;
  actionTo?: string;
  actionLabel?: string;
}) {
  const { isPending, error, has } = useMe();

  if (isPending) {
    return (
      <AppShell title={title}>
        <p className="px-4 py-6 text-sm text-muted-foreground">Checking your access…</p>
      </AppShell>
    );
  }
  if (error) {
    return (
      <AppShell title={title}>
        <p className="px-4 py-6 text-sm text-destructive">{(error as Error).message}</p>
      </AppShell>
    );
  }
  if (!has(...allow)) {
    return (
      <AppShell title={title}>
        <div className="mx-auto max-w-md px-4 py-8">
          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold text-foreground">You don't have access to this area</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {hint ?? "Ask a Twende Meru Rides administrator to grant you the right role."}
            </p>
            {actionTo && actionLabel ? (
              <Link
                to={actionTo}
                className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                {actionLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </AppShell>
    );
  }
  return <>{children}</>;
}

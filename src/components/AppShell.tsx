import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, type AppRole } from "@/hooks/useMe";
import { PhoneVerifyGate } from "@/components/PhoneVerifyBanner";


type Tab = { to: string; label: string };

const customerTabs: Tab[] = [
  { to: "/book", label: "Book" },
  { to: "/rides", label: "My rides" },
];

/** Tabs a person may use, derived from the roles the server reported. */
export function tabsForRoles(roles: AppRole[]): Tab[] {
  const has = (...wanted: AppRole[]) => wanted.some((role) => roles.includes(role));
  const tabs: Tab[] = [...customerTabs];
  if (has("driver")) tabs.push({ to: "/driver", label: "Drive" });
  if (has("fleet_owner")) tabs.push({ to: "/fleet", label: "Fleet" });
  if (has("ops_admin", "super_admin")) tabs.push({ to: "/admin", label: "Ops" });
  if (has("finance_admin", "super_admin")) tabs.push({ to: "/admin/finance", label: "Finance" });
  if (has("super_admin")) tabs.push({ to: "/admin/pricing", label: "Pricing" });
  if (has("super_admin")) tabs.push({ to: "/admin/staff", label: "People" });
  return tabs;
}

export function AppShell({
  title,
  children,
  tabs,
  eyebrow = "Twende Meru Rides",
  hideNav = false,
}: {
  title: string;
  children: ReactNode;
  tabs?: Tab[];
  eyebrow?: string;
  /** Full-screen flows (destination search) take over the bottom of the screen. */
  hideNav?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { roles } = useMe();
  const visibleTabs = tabs ?? tabsForRoles(roles);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="glass-bar sticky top-0 z-40 flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p>
          <h1 className="font-display text-base font-semibold text-foreground">{title}</h1>
        </div>
        <button
          onClick={signOut}
          className="rounded-full border border-border bg-secondary px-3.5 py-1.5 text-xs font-medium text-foreground transition-transform active:scale-95"
        >
          Sign out
        </button>
      </header>

      <div className={hideNav ? "flex-1" : "flex-1 pb-28"}>
        <PhoneVerifyGate>{children}</PhoneVerifyGate>
      </div>


      {!hideNav && (
      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-[0_10px_36px_-10px_rgba(0,0,0,0.45)]">
          {visibleTabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="flex-1 whitespace-nowrap rounded-full px-3 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors"
              activeProps={{
                className:
                  "flex-1 whitespace-nowrap rounded-full px-3 py-2.5 text-center text-sm font-semibold bg-primary text-primary-foreground shadow-[0_2px_12px_-4px_rgba(0,0,0,0.35)]",
              }}
              activeOptions={{ exact: true }}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
      )}
    </div>
  );
}

export const driverTabs: Tab[] = [
  { to: "/driver", label: "Drive" },
  { to: "/driver/wallet", label: "Wallet" },
  { to: "/driver/apply", label: "Onboarding" },
];

export const adminTabs: Tab[] = [
  { to: "/admin", label: "Ops" },
  { to: "/admin/finance", label: "Finance" },
  { to: "/admin/pricing", label: "Pricing" },
  { to: "/admin/staff", label: "People" },
];

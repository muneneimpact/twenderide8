import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, type AppRole } from "@/hooks/useMe";
import { PhoneVerifyGate } from "@/components/PhoneVerifyBanner";

type Tab = { to: string; label: string };

const customerTabs: Tab[] = [
  { to: "/book", label: "Book" },
  { to: "/rides", label: "My rides" },
  { to: "/hire", label: "Car Hire" },
  { to: "/lost-found", label: "Lost & found" },
  { to: "/account", label: "Account" },
];

/** Tabs a person may use, derived from the roles the server reported. */
export function tabsForRoles(roles: AppRole[], driverApproved = true): Tab[] {
  const has = (...wanted: AppRole[]) => wanted.some((role) => roles.includes(role));
  // Applicants awaiting approval only get onboarding; driver tools unlock on approval.
  if (has("driver") && !driverApproved) {
    return [...customerTabs.slice(0, 4), { to: "/driver/apply", label: "Onboarding" }, customerTabs[4]!];
  }
  // Drivers land on the driver console: their primary nav is Book, Account,
  // then Drive (the console). Rides remain reachable via the account page.
  if (has("driver")) {
    const tabs: Tab[] = [
      { to: "/book", label: "Book" },
      { to: "/account", label: "Account" },
      { to: "/driver", label: "Drive" },
      { to: "/lost-found", label: "Lost & found" },
    ];
    if (has("fleet_owner")) tabs.push({ to: "/fleet", label: "Fleet" });
    return tabs;
  }
  const tabs: Tab[] = [...customerTabs];
  if (has("fleet_owner")) tabs.push({ to: "/fleet", label: "Fleet" });
  if (has("fleet_owner")) tabs.push({ to: "/delivery/business", label: "Delivery" });
  if (has("ops_admin", "super_admin")) tabs.push({ to: "/admin/whatsapp", label: "WhatsApp" });
  if (has("ops_admin", "super_admin")) tabs.push({ to: "/admin", label: "Ops" });
  if (has("ops_admin", "super_admin")) tabs.push({ to: "/admin/hire", label: "Hire ops" });
  if (has("finance_admin", "super_admin")) tabs.push({ to: "/admin/finance", label: "Finance" });
  if (has("super_admin")) tabs.push({ to: "/admin/pricing", label: "Pricing" });
  if (has("super_admin")) tabs.push({ to: "/admin/staff", label: "People" });
  if (has("super_admin")) tabs.push({ to: "/admin/documents", label: "Letterhead" });
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
  const { roles, me } = useMe();
  const isStaff = roles.some((r) => r === "ops_admin" || r === "finance_admin" || r === "super_admin");
  const canManageHire = Boolean(me?.hasHireVehicles || me?.fleets?.length || roles.includes("fleet_owner"));
  const driverApproved = !me || isStaff || !roles.includes("driver") || me.driver?.status === "approved";
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const lockedDriverPage = !driverApproved && pathname.startsWith("/driver") && !pathname.startsWith("/driver/apply");
  const baseTabs = driverApproved
    ? (tabs ?? tabsForRoles(roles))
    : tabs === driverTabs
      ? driverTabs.filter((t) => t.to === "/driver/apply").concat(customerTabs.filter((t) => t.to === "/book" || t.to === "/account"))
      : tabsForRoles(roles, false);
  const visibleTabs = canManageHire && !baseTabs.some((tab) => tab.to === "/owner")
    ? [...baseTabs.slice(0, 2), { to: "/owner", label: "Owner Hub" }, ...baseTabs.slice(2)]
    : baseTabs;
  const compactDock = visibleTabs.length <= 6;
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeTab = dockRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    activeTab?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [pathname]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="glass-bar sticky top-0 z-40 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="truncate font-display text-base font-semibold text-foreground">{title}</h1>
        </div>
        <button
          onClick={signOut}
          className="rounded-full border border-border bg-secondary px-3.5 py-1.5 text-xs font-medium text-foreground transition-transform active:scale-95"
        >
          Sign out
        </button>
      </header>

      <div className={`mx-auto w-full max-w-6xl min-w-0 overflow-x-hidden ${hideNav ? "flex-1" : "flex-1 pb-28"}`}>
        <PhoneVerifyGate>
          {lockedDriverPage ? (
            <div className="mx-auto max-w-md px-4 py-10 text-center">
              <h2 className="font-display text-lg font-semibold text-foreground">Finish onboarding first</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Driving, wallet, hire cars and driver lost &amp; found open once Twende approves your application.
              </p>
              <Link to="/driver/apply" className="mt-4 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
                Go to onboarding
              </Link>
            </div>
          ) : (
            children
          )}
        </PhoneVerifyGate>
      </div>

      {!hideNav && (
        <nav
          aria-label="Primary navigation"
          className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-primary/20 bg-background/95 px-2 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:px-3"
        >
          <div
            ref={dockRef}
            className="mx-auto flex w-full max-w-4xl snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain rounded-2xl border-2 border-primary/25 bg-card p-1.5 shadow-[0_10px_36px_-10px_rgba(0,0,0,0.45)] backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {visibleTabs.map((tab) => {
              // Every tab is bold green when inactive so none reads as "selected";
              // the active tab is the filled green pill with white text.
              const inactiveClass = compactDock
                ? "flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-xl px-1 py-2 text-center text-[11px] font-bold leading-tight text-primary transition-colors sm:text-sm"
                : "flex min-h-11 min-w-[76px] shrink-0 snap-center items-center justify-center whitespace-nowrap rounded-full px-3 py-2.5 text-center text-xs font-bold text-primary transition-colors sm:text-sm md:flex-1";
              const activeClass = compactDock
                ? "flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-xl bg-primary px-1 py-2 text-center text-[11px] font-bold leading-tight text-primary-foreground sm:text-sm"
                : "flex min-h-11 min-w-[76px] shrink-0 snap-center items-center justify-center whitespace-nowrap rounded-full bg-primary px-3 py-2.5 text-center text-xs font-bold text-primary-foreground shadow-[0_2px_12px_-4px_rgba(0,0,0,0.35)] sm:text-sm md:flex-1";
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={inactiveClass}
                  activeProps={{
                    "aria-current": "page",
                    className: activeClass,
                  }}
                  activeOptions={{ exact: true }}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

export const driverTabs: Tab[] = [
  { to: "/driver", label: "Drive" },
  { to: "/driver/wallet", label: "Wallet" },
  { to: "/driver/hire", label: "Hire cars" },
  { to: "/driver/apply", label: "Onboarding" },
  { to: "/lost-found", label: "Lost & found" },
];

export const adminTabs: Tab[] = [
  { to: "/admin", label: "Ops" },
  { to: "/admin/unattended", label: "Unattended" },
  { to: "/admin/support", label: "Claims" },
  { to: "/admin/whatsapp", label: "WhatsApp" },
  { to: "/admin/finance", label: "Finance" },
  { to: "/admin/pricing", label: "Pricing" },
  { to: "/admin/staff", label: "People" },
  { to: "/admin/documents", label: "Letterhead" },
];

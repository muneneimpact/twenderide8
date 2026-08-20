import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

type Tab = { to: string; label: string };

const customerTabs: Tab[] = [
  { to: "/book", label: "Book" },
  { to: "/rides", label: "My rides" },
];

export function AppShell({
  title,
  children,
  tabs = customerTabs,
  eyebrow = "Twende Ride",
}: {
  title: string;
  children: ReactNode;
  tabs?: Tab[];
  eyebrow?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
          className="glass rounded-full px-3.5 py-1.5 text-xs font-medium text-foreground transition-transform active:scale-95"
        >
          Sign out
        </button>
      </header>

      <div className="flex-1 pb-24">{children}</div>

      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
        <div className="glass-strong mx-auto flex max-w-md gap-1 p-1.5 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)]">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="flex-1 rounded-full px-3 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors"
              activeProps={{
                className:
                  "flex-1 rounded-full px-3 py-2.5 text-center text-sm font-semibold bg-primary text-primary-foreground shadow-[0_2px_12px_-4px_rgba(0,0,0,0.35)]",
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export const driverTabs: Tab[] = [
  { to: "/driver", label: "Drive" },
  { to: "/driver/wallet", label: "Wallet" },
];

import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const tabs = [
  { to: "/book", label: "Book" },
  { to: "/rides", label: "My rides" },
] as const;

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
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
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Twende Ride
          </p>
          <h1 className="font-display text-base font-semibold text-foreground">{title}</h1>
        </div>
        <button
          onClick={signOut}
          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground"
        >
          Sign out
        </button>
      </header>

      <div className="flex-1 pb-20">{children}</div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="flex-1 px-3 py-3 text-center text-sm font-medium text-muted-foreground"
            activeProps={{ className: "flex-1 px-3 py-3 text-center text-sm font-semibold text-primary" }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

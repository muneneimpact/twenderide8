import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMe } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "customer"
  | "driver"
  | "fleet_owner"
  | "ops_admin"
  | "finance_admin"
  | "super_admin";

/** Single source of truth for what the signed-in person may see. */
export function useMe() {
  const fetchMe = useServerFn(getMe);
  // Only ask the server who we are once a browser session (and thus a bearer
  // token) actually exists — otherwise the call 401s and blanks the app.
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchMe({}),
    staleTime: 30_000,
    enabled: hasSession === true,
    retry: false,
  });
  const roles = (query.data?.roles ?? []) as AppRole[];

  const has = (...wanted: AppRole[]) => wanted.some((role) => roles.includes(role));

  return {
    ...query,
    me: query.data ?? null,
    roles,
    has,
    isDriver: has("driver"),
    isFleetOwner: has("fleet_owner"),
    isOps: has("ops_admin", "super_admin"),
    isFinance: has("finance_admin", "super_admin"),
    isSuper: has("super_admin"),
    isStaff: has("ops_admin", "finance_admin", "super_admin"),
    isHireOwner: Boolean(query.data?.hasHireVehicles || query.data?.fleets?.length || has("fleet_owner")),
  };
}

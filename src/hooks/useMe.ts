import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMe } from "@/lib/account.functions";

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
  const query = useQuery({ queryKey: ["me"], queryFn: () => fetchMe({}), staleTime: 30_000 });
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
  };
}

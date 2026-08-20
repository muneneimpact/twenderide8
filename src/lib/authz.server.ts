/** Server-only role checks. Roles live in public.user_roles, never on profiles. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export async function getRoles(userId: string): Promise<AppRole[]> {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((row) => row.role);
}

export async function requireRole(userId: string, allowed: AppRole[]): Promise<AppRole[]> {
  const roles = await getRoles(userId);
  if (!roles.some((role) => allowed.includes(role))) {
    throw new Error("You do not have permission to perform this action.");
  }
  return roles;
}

export const STAFF: AppRole[] = ["ops_admin", "finance_admin", "super_admin"];
export const OPS: AppRole[] = ["ops_admin", "super_admin"];
export const FINANCE: AppRole[] = ["finance_admin", "super_admin"];
export const SUPER: AppRole[] = ["super_admin"];

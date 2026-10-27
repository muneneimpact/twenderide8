import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listPendingTrustedBrands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("hire_owner_trusted_brands")
      .select("id, owner_user_id, brand_name, permission_confirmed, status, admin_note, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ownerIds = (data ?? []).map((row: { owner_user_id: string }) => row.owner_user_id);
    const { data: profiles } = ownerIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", ownerIds)
      : { data: [] };
    return (data ?? []).map((row: any) => ({ ...row, owner: profiles?.find((profile) => profile.id === row.owner_user_id) ?? null }));
  });

export const reviewTrustedBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(400).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("hire_owner_trusted_brands")
      .update({ status: data.decision, admin_note: data.note ?? null, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("id, status, admin_note")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

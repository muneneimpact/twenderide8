import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ownerQuotes(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { ownedVehicleIds } = await import("./hire-owner.server");
  const ids = await ownedVehicleIds(userId);
  if (!ids.length) return { supabaseAdmin, quotes: [] as any[] };
  const { data, error } = await supabaseAdmin
    .from("hire_quotes")
    .select("id, requester_id, reference, status, payment_status, payment_paid_total, agreement_completed_at, start_at")
    .in("vehicle_id", ids)
    .not("requester_id", "is", null)
    .order("start_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { supabaseAdmin, quotes: data ?? [] };
}

export const listOwnerCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin, quotes } = await ownerQuotes(context.userId);
    const earned = quotes.filter((quote) =>
      !["cancelled", "cancelled_by_customer", "cancelled_by_owner", "timed_out"].includes(String(quote.status)) &&
      (["partial", "paid", "legacy"].includes(String(quote.payment_status)) || Number(quote.payment_paid_total ?? 0) > 0),
    );
    const ids = [...new Set(earned.map((quote) => quote.requester_id).filter(Boolean))];
    const { data: profiles } = ids.length ? await supabaseAdmin.from("profiles").select("id, full_name, email, phone").in("id", ids) : { data: [] };
    return ids.map((id) => {
      const customerQuotes = earned.filter((quote) => quote.requester_id === id);
      const profile = profiles?.find((item) => item.id === id);
      return {
        id,
        name: profile?.full_name ?? "Customer",
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        hires: customerQuotes.length,
        points: customerQuotes.length,
        lastHireAt: customerQuotes[0]?.start_at ?? null,
      };
    });
  });

export const listOwnerPromotions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).from("hire_owner_promotions").select("id, title, description, reward_points, discount_percent, merchandise, status, expires_at, created_at").eq("owner_user_id", context.userId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createOwnerPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ title: z.string().trim().min(2).max(100), description: z.string().trim().min(2).max(500), rewardPoints: z.number().int().min(0).max(100000), discountPercent: z.number().min(0).max(100), merchandise: z.string().trim().max(200).optional(), expiresAt: z.string().datetime().nullable().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any).from("hire_owner_promotions").insert({ owner_user_id: context.userId, title: data.title, description: data.description, reward_points: data.rewardPoints, discount_percent: data.discountPercent, merchandise: data.merchandise || null, expires_at: data.expiresAt ?? null }).select("id, title, description, reward_points, discount_percent, merchandise, status, expires_at, created_at").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listPublicOwnerPromotions = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ ownerUserId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any).from("hire_owner_promotions").select("id, title, description, reward_points, discount_percent, merchandise, expires_at").eq("owner_user_id", data.ownerUserId).eq("status", "active").or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order("created_at", { ascending: false }).limit(3);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

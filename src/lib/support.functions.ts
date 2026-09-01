/**
 * Customer support cases and the customer account surfaces that need server
 * data: live promotions, redemption history and the recent activity feed.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type SupportRole = "customer" | "agent" | "system";

export interface SupportMessageView {
  id: string;
  from: SupportRole;
  author: string;
  body: string;
  created_at: string;
}

export interface SupportCaseView {
  id: string;
  customer_id: string;
  reporter_name: string;
  reporter_phone: string;
  trip_reference: string | null;
  category: string;
  subject: string;
  description: string;
  status: "open" | "in_progress" | "resolved";
  assigned_agent: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  messages: SupportMessageView[];
}

const caseStatus = z.enum(["open", "in_progress", "resolved"]);

/** Shapes rows into the view the support screens render. */
function toView(
  row: {
    id: string;
    customer_id: string;
    ride_id: string | null;
    subject: string;
    category: string;
    status: string;
    assigned_to: string | null;
    created_at: string;
    updated_at: string;
  },
  names: Map<string, { full_name: string | null; phone: string | null }>,
  rideRefs: Map<string, string>,
  messages: SupportMessageView[],
): SupportCaseView {
  const reporter = names.get(row.customer_id);
  const agent = row.assigned_to ? names.get(row.assigned_to) : null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    reporter_name: reporter?.full_name ?? "Twende customer",
    reporter_phone: reporter?.phone ?? "",
    trip_reference: row.ride_id ? (rideRefs.get(row.ride_id) ?? null) : null,
    category: row.category,
    subject: row.subject,
    description: messages[0]?.body ?? "",
    status: (["open", "in_progress", "resolved"].includes(row.status) ? row.status : "open") as
      | "open"
      | "in_progress"
      | "resolved",
    assigned_agent: agent?.full_name ?? (row.assigned_to ? "Assigned agent" : null),
    assigned_to: row.assigned_to,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages,
  };
}

async function buildCases(
  rows: Array<Record<string, unknown>>,
): Promise<SupportCaseView[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cases = rows as unknown as Array<Parameters<typeof toView>[0] & { ride_id: string | null }>;
  if (cases.length === 0) return [];

  const caseIds = cases.map((c) => c.id);
  const { data: messageRows } = await supabaseAdmin
    .from("support_messages")
    .select("*")
    .in("case_id", caseIds)
    .order("created_at", { ascending: true });

  const userIds = new Set<string>();
  cases.forEach((c) => {
    userIds.add(c.customer_id);
    if (c.assigned_to) userIds.add(c.assigned_to);
  });
  (messageRows ?? []).forEach((m) => {
    if (m.sender_id) userIds.add(m.sender_id);
  });

  const rideIds = cases.map((c) => c.ride_id).filter((v): v is string => Boolean(v));
  const [{ data: profiles }, { data: rides }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", Array.from(userIds)),
    rideIds.length
      ? supabaseAdmin.from("rides").select("id, reference").in("id", rideIds)
      : Promise.resolve({ data: [] as Array<{ id: string; reference: string }> }),
  ]);

  const names = new Map((profiles ?? []).map((p) => [p.id, { full_name: p.full_name, phone: p.phone }]));
  const rideRefs = new Map((rides ?? []).map((r) => [r.id, r.reference]));

  return cases.map((c) =>
    toView(
      c,
      names,
      rideRefs,
      (messageRows ?? [])
        .filter((m) => m.case_id === c.id)
        .map((m) => ({
          id: m.id,
          from: (m.sender_role as SupportRole) ?? "customer",
          author: (m.sender_id ? names.get(m.sender_id)?.full_name : null) ?? "Twende",
          body: m.body,
          created_at: m.created_at,
        })),
    ),
  );
}

/* ------------------------------ CUSTOMER -------------------------------- */

export const listMySupportCases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("support_cases")
      .select("*")
      .eq("customer_id", context.userId)
      .order("last_message_at", { ascending: false });
    return buildCases((data ?? []) as unknown as Array<Record<string, unknown>>);
  });

export const createSupportCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        subject: z.string().trim().min(4).max(160).optional(),
        category: z.enum(["safety", "fare", "payment", "refund", "driver_conduct", "vehicle", "general", "other"]),
        description: z.string().trim().min(10).max(2000),
        rideId: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const subject = data.subject?.trim() || data.description.slice(0, 60);
    const { data: created, error } = await context.supabase
      .from("support_cases")
      .insert({
        customer_id: context.userId,
        ride_id: data.rideId ?? null,
        subject,
        category: data.category,
        status: "open",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: messageError } = await context.supabase.from("support_messages").insert({
      case_id: created.id,
      sender_id: context.userId,
      sender_role: "customer",
      body: data.description,
    });
    if (messageError) throw new Error(messageError.message);
    return { id: created.id };
  });

export const postSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ caseId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: supportCase } = await context.supabase
      .from("support_cases")
      .select("id, customer_id")
      .eq("id", data.caseId)
      .maybeSingle();
    if (!supportCase) throw new Error("That support case is not available.");

    const isCustomer = supportCase.customer_id === context.userId;
    const { error } = await context.supabase.from("support_messages").insert({
      case_id: data.caseId,
      sender_id: context.userId,
      sender_role: isCustomer ? "customer" : "agent",
      body: data.body,
    });
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("support_cases")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", data.caseId);
    return { ok: true };
  });

/* -------------------------------- STAFF --------------------------------- */

export const listSupportCases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("support_cases")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(200);
    return buildCases((data ?? []) as unknown as Array<Record<string, unknown>>);
  });

export const setSupportCaseStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ caseId: z.string().uuid(), status: caseStatus }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { error } = await supabaseAdmin
      .from("support_cases")
      .update({ status: data.status })
      .eq("id", data.caseId);
    if (error) throw new Error(error.message);
    await audit(context.userId, `support_case_${data.status}`, "support_case", data.caseId);
    return { ok: true };
  });

export const assignSupportCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { error } = await supabaseAdmin
      .from("support_cases")
      .update({ assigned_to: context.userId, status: "in_progress" })
      .eq("id", data.caseId);
    if (error) throw new Error(error.message);
    await audit(context.userId, "support_case_assigned", "support_case", data.caseId);
    return { ok: true };
  });

/* ----------------------------- PROMOTIONS ------------------------------- */

export const listMyPromotions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { promoState } = await import("./discounts");
    const [{ data: promos }, { data: redemptions }] = await Promise.all([
      context.supabase.from("promotions").select("*").eq("active", true).order("created_at", { ascending: false }),
      context.supabase
        .from("promotion_redemptions")
        .select("promotion_id, code, discount_amount, created_at")
        .eq("customer_id", context.userId)
        .order("created_at", { ascending: false }),
    ]);
    const used = new Set((redemptions ?? []).map((r) => r.promotion_id));
    return {
      promotions: (promos ?? []).map((promo) => ({
        id: promo.id,
        code: promo.code,
        name: promo.name,
        description: promo.description,
        discount_percent: Number(promo.discount_percent),
        max_discount_percent: Number(promo.max_discount_percent),
        state: promoState(promo),
        used: used.has(promo.id),
      })),
      redemptions: (redemptions ?? []).map((r) => ({
        code: r.code,
        discount_amount: Number(r.discount_amount),
        created_at: r.created_at,
      })),
    };
  });

/* --------------------------- ACCOUNT SURFACES ---------------------------- */

export const updateAccountPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        payment_preference: z.enum(["stk_push", "cash"]).optional(),
        share_driver_code: z.boolean().optional(),
        avatar_path: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.avatar_path && !data.avatar_path.startsWith(`${context.userId}/`)) {
      throw new Error("That upload does not belong to your account.");
    }
    const { error } = await context.supabase
      .from("profiles")
      .update({
        ...(data.payment_preference ? { payment_preference: data.payment_preference } : {}),
        ...(data.share_driver_code === undefined ? {} : { share_driver_code: data.share_driver_code }),
        ...(data.avatar_path ? { avatar_url: data.avatar_path } : {}),
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  created_at: string;
  payment_kind: "mpesa" | "cash" | "refund" | null;
}

/** Rides, payments, promo redemptions and support activity, newest first. */
export const getAccountActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ActivityItem[]> => {
    const { supabase, userId } = context;
    const [{ data: rides }, { data: cases }, { data: redemptions }] = await Promise.all([
      supabase
        .from("rides")
        .select("id, reference, status, total_fare, payment_method, payment_status, requested_at")
        .eq("customer_id", userId)
        .order("requested_at", { ascending: false })
        .limit(15),
      supabase
        .from("support_cases")
        .select("id, subject, status, created_at")
        .eq("customer_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("promotion_redemptions")
        .select("id, code, discount_amount, created_at")
        .eq("customer_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const items: ActivityItem[] = [];
    for (const ride of rides ?? []) {
      items.push({
        id: `ride:${ride.id}`,
        title: `${ride.reference} · ${ride.status.replace(/_/g, " ")}`,
        detail: `KES ${Number(ride.total_fare).toFixed(2)}`,
        created_at: ride.requested_at,
        payment_kind: null,
      });
      if (ride.payment_status === "paid" || ride.payment_status === "refunded") {
        items.push({
          id: `pay:${ride.id}`,
          title: ride.payment_status === "refunded" ? "Refund" : "Payment",
          detail: `KES ${Number(ride.total_fare).toFixed(2)} · ${ride.payment_status}`,
          created_at: ride.requested_at,
          payment_kind:
            ride.payment_status === "refunded" ? "refund" : ride.payment_method === "cash" ? "cash" : "mpesa",
        });
      }
    }
    for (const c of cases ?? []) {
      items.push({
        id: `case:${c.id}`,
        title: `Support case · ${c.status.replace(/_/g, " ")}`,
        detail: c.subject,
        created_at: c.created_at,
        payment_kind: null,
      });
    }
    for (const r of redemptions ?? []) {
      items.push({
        id: `promo:${r.id}`,
        title: `Promo applied · ${r.code}`,
        detail: `Saved KES ${Number(r.discount_amount).toFixed(2)}`,
        created_at: r.created_at,
        payment_kind: null,
      });
    }
    return items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 25);
  });

/** Audit trail for one support case, for the operations detail panel. */
export const getSupportCaseAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("audit_logs")
      .select("id, action, actor_id, created_at")
      .eq("entity_type", "support_case")
      .eq("entity_id", data.caseId)
      .order("created_at", { ascending: true });
    const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter((v): v is string => Boolean(v))));
    const { data: profiles } = actorIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", actorIds)
      : { data: [] as Array<{ id: string; full_name: string | null }> };
    const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    return (rows ?? []).map((r) => ({
      id: r.id,
      action: r.action.replace(/^support_case_/, "").replace(/_/g, " "),
      actor: (r.actor_id ? names.get(r.actor_id) : null) ?? "Twende ops",
      created_at: r.created_at,
    }));
  });

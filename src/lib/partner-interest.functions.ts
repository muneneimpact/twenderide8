import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normaliseKenyanPhone } from "@/lib/phone";
import { z } from "zod";

const submissionSchema = z.object({
  requestType: z.enum(["driver", "car_owner"]),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  town: z.string().trim().min(2).max(120),
  preferredWorkType: z.enum(["boda", "e_boda", "car_taxi", "delivery"]).optional(),
  ownsVehicle: z.boolean().optional(),
  licencePsvStatus: z.string().trim().max(160).optional(),
  numberOfCars: z.number().int().min(1).max(100).optional(),
  bestTime: z.string().trim().min(2).max(100),
  note: z.string().trim().max(1000).optional(),
  whatsappOptIn: z.boolean().default(true),
});
const reviewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "contacted", "approved", "declined", "closed"]),
});

type InterestRow = {
  id: string;
  request_type: "driver" | "car_owner";
  full_name: string;
  phone: string;
  town: string;
  preferred_work_type: string | null;
  owns_vehicle: boolean | null;
  licence_psv_status: string | null;
  number_of_cars: number | null;
  best_time: string;
  note: string | null;
  status: "new" | "contacted" | "approved" | "declined" | "closed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  whatsapp_opt_in: boolean;
};

function dbClient(supabaseAdmin: unknown) {
  type Query = {
    eq: (column: string, value: string) => Query;
    gte: (column: string, value: string) => Query;
    maybeSingle: () => Promise<{ data: InterestRow | null; error: { message: string } | null }>;
  };
  return supabaseAdmin as {
    from: (table: string) => {
      select: (columns: string) => Query & {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => Promise<{ data: InterestRow[] | null; error: { message: string } | null }>;
      };
      insert: (values: Record<string, unknown>) => {
        select: (columns: string) => {
          single: () => Promise<{ data: InterestRow | null; error: { message: string } | null }>;
        };
      };
      update: (values: Record<string, unknown>) => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

export const submitPartnerInterest = createServerFn({ method: "POST" })
  .inputValidator((input) => submissionSchema.parse(input))
  .handler(async ({ data }) => {
    const phone = normaliseKenyanPhone(data.phone);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = dbClient(supabaseAdmin);
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: recent, error: duplicateError } = await db
      .from("partner_interest_requests")
      .select("id")
      .eq("phone", phone)
      .eq("request_type", data.requestType)
      .gte("created_at", since)
      .maybeSingle();
    if (duplicateError)
      throw new Error(`Could not check your previous request: ${duplicateError.message}`);
    if (recent) return { duplicate: true };
    const { data: row, error } = await db
      .from("partner_interest_requests")
      .insert({
        request_type: data.requestType,
        full_name: data.fullName,
        phone,
        town: data.town,
        preferred_work_type:
          data.requestType === "driver" ? (data.preferredWorkType ?? null) : null,
        owns_vehicle: data.requestType === "driver" ? (data.ownsVehicle ?? null) : null,
        licence_psv_status: data.requestType === "driver" ? data.licencePsvStatus || null : null,
        number_of_cars: data.requestType === "car_owner" ? (data.numberOfCars ?? null) : null,
        best_time: data.bestTime,
        note: data.note || null,
        whatsapp_opt_in: data.whatsappOptIn,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Could not save your interest: ${error.message}`);
    if (row) {
      const { notifyPartnerInterest } = await import("@/lib/partner-interest-notifications.server");
      await notifyPartnerInterest({
        id: row.id,
        name: row.full_name,
        phone: row.phone,
        requestType: row.request_type,
        status: row.status,
        whatsappOptIn: row.whatsapp_opt_in,
        event: "submitted",
      });
    }
    return { duplicate: false };
  });

export const listPartnerInterestRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("@/lib/authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await dbClient(supabaseAdmin)
      .from("partner_interest_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Could not load partner interest requests: ${error.message}`);
    return data ?? [];
  });

export const reviewPartnerInterest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => reviewSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("@/lib/authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = dbClient(supabaseAdmin);
    const { data: row, error: loadError } = await db
      .from("partner_interest_requests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError || !row) throw new Error("Interest request not found.");
    const { error } = await dbClient(supabaseAdmin)
      .from("partner_interest_requests")
      .update({
        status: data.status,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(`Could not update the interest request: ${error.message}`);
    const { notifyPartnerInterest } = await import("@/lib/partner-interest-notifications.server");
    await notifyPartnerInterest({
      id: row.id,
      name: row.full_name,
      phone: row.phone,
      requestType: row.request_type,
      status: data.status,
      whatsappOptIn: row.whatsapp_opt_in,
      event: "updated",
    });
    return { ok: true };
  });

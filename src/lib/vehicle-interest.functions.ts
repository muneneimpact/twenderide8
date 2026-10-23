import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const requestSchema = z
  .object({
    tripNeeds: z.string().trim().min(10).max(1200),
    contactName: z.string().trim().min(2).max(120),
    contactPhone: z.string().trim().max(40).optional(),
    contactEmail: z.string().trim().email().max(160).optional(),
    recommendedVehicleIds: z.array(z.string().uuid()).max(3).default([]),
  })
  .refine((value) => Boolean(value.contactPhone || value.contactEmail), {
    message: "Add a phone number or email address so Twende can respond.",
  });

const adminUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "in_progress", "responded", "closed"]),
  response: z.string().trim().max(2000).optional(),
});

function dbClient(supabaseAdmin: unknown) {
  return supabaseAdmin as {
    from: (table: string) => {
      insert: (values: Record<string, unknown>) => {
        select: (columns: string) => {
          single: () => Promise<{
            data: { id: string; created_at: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
      select: (columns: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => Promise<{ data: InterestRow[] | null; error: { message: string } | null }>;
      };
      update: (values: Record<string, unknown>) => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

type InterestRow = {
  id: string;
  trip_needs: string;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  recommended_vehicle_ids: string[];
  status: "new" | "in_progress" | "responded" | "closed";
  admin_response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

export const submitVehicleInterest = createServerFn({ method: "POST" })
  .inputValidator((input) => requestSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await dbClient(supabaseAdmin)
      .from("vehicle_interest_requests")
      .insert({
        trip_needs: data.tripNeeds,
        contact_name: data.contactName,
        contact_phone: data.contactPhone || null,
        contact_email: data.contactEmail || null,
        recommended_vehicle_ids: data.recommendedVehicleIds,
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(`Could not save your request: ${error.message}`);
    return { id: row?.id ?? null, createdAt: row?.created_at ?? null };
  });

export const listVehicleInterestRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("@/lib/authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await dbClient(supabaseAdmin)
      .from("vehicle_interest_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Could not load vehicle interest requests: ${error.message}`);
    return data ?? [];
  });

export const updateVehicleInterestRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("@/lib/authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const response = data.response?.trim() || null;
    const { error } = await dbClient(supabaseAdmin)
      .from("vehicle_interest_requests")
      .update({
        status: data.status,
        admin_response: response,
        responded_by: response ? context.userId : null,
        responded_at: response ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(`Could not update the request: ${error.message}`);
    return { ok: true };
  });

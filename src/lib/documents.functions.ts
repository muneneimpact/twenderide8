import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Letterhead + logos used on every receipt and agreement. */
export const getBranding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("document_branding").select("*").eq("key", "default").maybeSingle();
    return data;
  });

const brandSchema = z.object({
  company_name: z.string().trim().min(2).max(120),
  tagline: z.string().max(200).nullable(),
  address: z.string().max(300).nullable(),
  phone: z.string().max(60).nullable(),
  email: z.string().max(160).nullable(),
  kra_pin: z.string().max(40).nullable(),
  website: z.string().max(160).nullable(),
  logo_data_url: z.string().max(700_000).nullable(),
  extra_logos: z.array(z.string().max(700_000)).max(4),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  receipt_footer: z.string().max(1000).nullable(),
  agreement_footer: z.string().max(1000).nullable(),
  agreement_extra_terms: z.string().max(6000).nullable(),
});

export const saveBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => brandSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    for (const l of [data.logo_data_url, ...data.extra_logos]) {
      if (l && !/^data:image\/(png|jpeg);base64,/.test(l)) throw new Error("Logos must be PNG or JPG.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("document_branding")
      .upsert({ key: "default", ...data, updated_by: context.userId, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMySignature = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("owner_signatures").select("*").eq("user_id", context.userId).maybeSingle();
    return data;
  });

export const saveMySignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({ signer_name: z.string().trim().min(2).max(120), signature: z.string().min(3).max(400_000), auto_sign: z.boolean() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    if (!data.signature.startsWith("data:image/png") && !data.signature.startsWith("typed:")) throw new Error("Invalid signature.");
    const { error } = await context.supabase
      .from("owner_signatures")
      .upsert({ user_id: context.userId, ...data, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Receipt data for any paid/completed trip of the signed-in customer. */
export const getRideReceipt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ rideId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id, reference, customer_id, driver_id, vehicle_id, quote_id, total_fare, payment_method, requested_at, completed_at, status")
      .eq("id", data.rideId)
      .maybeSingle();
    if (!ride || (ride.customer_id !== context.userId && ride.driver_id !== context.userId)) throw new Error("Trip not found.");
    const [{ data: me }, { data: quote }, { data: driver }, { data: vehicle }, { data: brand }, { data: pays }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name, phone").eq("id", ride.customer_id).maybeSingle(),
      ride.quote_id
        ? supabaseAdmin.from("route_quotes").select("pickup_address, dropoff_address, distance_km").eq("id", ride.quote_id).maybeSingle()
        : Promise.resolve({ data: null }),
      ride.driver_id ? supabaseAdmin.from("profiles").select("full_name").eq("id", ride.driver_id).maybeSingle() : Promise.resolve({ data: null }),
      ride.vehicle_id ? supabaseAdmin.from("vehicles").select("make, model, plate_number").eq("id", ride.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
      supabaseAdmin.from("document_branding").select("*").eq("key", "default").maybeSingle(),
      supabaseAdmin.from("payment_intents").select("provider_reference, amount, status, updated_at").eq("ride_id", ride.id).eq("status", "paid"),
    ]);
    const q = quote as { pickup_address?: string | null; dropoff_address?: string | null; distance_km?: number | null } | null;
    const v = vehicle as { make?: string | null; model?: string | null; plate_number?: string | null } | null;
    const total = Number(ride.total_fare ?? 0);
    const mpesa = (pays ?? []).map((p) => ({ code: p.provider_reference as string | null, amount: Number(p.amount), at: p.updated_at as string, method: "M-PESA" }));
    const payments = mpesa.length
      ? mpesa
      : ride.status === "trip_completed"
        ? [{ code: null, amount: total, at: ride.completed_at ?? ride.requested_at, method: ride.payment_method === "cash" ? "Cash" : "M-PESA" }]
        : [];
    return {
      branding: brand,
      receipt: {
        kind: "ride" as const,
        reference: ride.reference,
        customer: me?.full_name ?? "Customer",
        phone: me?.phone ?? null,
        lines: [
          ["Date", new Date(ride.completed_at ?? ride.requested_at).toLocaleString("en-KE")],
          ["From", q?.pickup_address ?? "-"],
          ["To", q?.dropoff_address ?? "-"],
          ["Distance", `${Number(q?.distance_km ?? 0).toFixed(1)} km`],
          ["Driver", (driver as { full_name?: string | null } | null)?.full_name ?? "-"],
          ["Vehicle", v ? `${[v.make, v.model].filter(Boolean).join(" ")} ${v.plate_number ?? ""}`.trim() : "-"],
        ] as [string, string][],
        total,
        paid: payments.reduce((a, p) => a + p.amount, 0),
        payments,
        issuedAt: new Date().toISOString(),
      },
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const INSPECTION_SIDES = ["front", "back", "left", "right"] as const;
export type InspectionSide = (typeof INSPECTION_SIDES)[number];

async function loadAccessible(quoteId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: q } = await supabaseAdmin.from("hire_quotes").select("*").eq("id", quoteId).maybeSingle();
  if (!q) throw new Error("Booking not found.");
  const { ownedVehicleIds } = await import("./hire-owner.server");
  const { getRoles, STAFF } = await import("./authz.server");
  const owned = q.vehicle_id ? (await ownedVehicleIds(userId)).includes(q.vehicle_id) : false;
  const isRenter = q.requester_id === userId;
  const isStaff = !isRenter && !owned ? (await getRoles(userId)).some((r) => STAFF.includes(r)) : false;
  if (!isRenter && !owned && q.assigned_driver_id !== userId && !isStaff) {
    throw new Error("You cannot view this agreement.");
  }
  return { q, supabaseAdmin, isRenter, isOwner: owned || isStaff };
}

/** Everything the printable hire agreement needs, auto-filled from the booking. */
export const getHireAgreement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ quoteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { q, supabaseAdmin, isOwner } = await loadAccessible(data.quoteId, context.userId);
    const [{ data: renter }, { data: vehicle }, { data: settlements }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name, phone, email, id_number").eq("id", q.requester_id).maybeSingle(),
      q.vehicle_id
        ? supabaseAdmin.from("vehicles").select("make, model, plate_number, colour, seats, vehicle_class, owner_driver_id, hire_rules, hire_insurance_details").eq("id", q.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("hire_payment_settlements").select("mpesa_receipt, gross_amount, created_at").eq("hire_quote_id", q.id).order("created_at"),
    ]);
    const v = vehicle as Record<string, unknown> | null;
    let owner: { full_name: string | null; phone: string | null } | null = null;
    if (v?.owner_driver_id) {
      const { data: p } = await supabaseAdmin.from("profiles").select("full_name, phone").eq("id", v.owner_driver_id as string).maybeSingle();
      owner = p ?? null;
    }
    const photos = (q.inspection_photos ?? {}) as Record<string, string>;
    const paths = Object.values(photos).filter(Boolean);
    const signed = paths.length
      ? (await supabaseAdmin.storage.from("hire-documents").createSignedUrls(paths, 1800)).data ?? []
      : [];
    const urlOf = (p: string) => signed.find((s) => s.path === p)?.signedUrl ?? null;
    const sig = q.agreement_signature?.trim() ?? null;
    return {
      canInspect: isOwner && !q.returned_at,
      quote: {
        id: q.id,
        reference: q.reference,
        status: q.status,
        hirer_type: q.hirer_type,
        organisation: q.organisation,
        drive_mode: q.drive_mode,
        start_at: q.start_at,
        end_at: q.end_at ?? new Date(new Date(q.start_at).getTime() + q.days * 86_400_000).toISOString(),
        days: q.days,
        passengers: q.passengers,
        pickup: q.pickup_label,
        total: Number(q.quoted_total ?? q.estimated_total),
        paid: Number(q.payment_paid_total ?? 0),
        payment_status: q.payment_status,
        pay_later_method: q.pay_later_method,
        pay_later_due_date: q.pay_later_due_date,
        business_email: q.business_email,
        business_registration_number: q.business_registration_number,
        business_address: q.business_address,
        signer: q.agreement_signer_name,
        signature: sig,
        signed_at: q.agreement_signed_at ?? q.rules_accepted_at,
        handed_over_at: q.handed_over_at,
        returned_at: q.returned_at,
        inspection_at: q.inspection_at,
        inspection_odometer: q.inspection_odometer,
        inspection_fuel: q.inspection_fuel,
        inspection_notes: q.inspection_notes,
      },
      renter: {
        name: q.renter_name ?? q.contact_name ?? renter?.full_name ?? "Hirer",
        phone: q.contact_phone ?? renter?.phone ?? null,
        email: q.contact_email ?? renter?.email ?? null,
        id_number: q.renter_id_number ?? renter?.id_number ?? null,
      },
      vehicle: v
        ? {
            name: [v.make, v.model].filter(Boolean).join(" ") || String(v.vehicle_class ?? "Vehicle"),
            plate: String(v.plate_number ?? ""),
            colour: (v.colour as string | null) ?? null,
            seats: (v.seats as number | null) ?? null,
            rules: (v.hire_rules as string | null) ?? null,
            insurance: (v.hire_insurance_details as string | null) ?? null,
          }
        : null,
      owner,
      receipts: (settlements ?? []).map((s) => ({ code: s.mpesa_receipt, amount: Number(s.gross_amount), at: s.created_at })),
      photos: Object.fromEntries(Object.entries(photos).map(([k, p]) => [k, urlOf(p)])) as Partial<Record<InspectionSide, string | null>>,
    };
  });

/** Pre-hire walkaround: four photos plus odometer and fuel, captured by the owner/driver. */
export const saveHireInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        quoteId: z.string().uuid(),
        photos: z.object({ front: z.string(), back: z.string(), left: z.string(), right: z.string() }),
        odometer: z.number().int().min(0).max(5_000_000).nullable(),
        fuel: z.string().max(40).nullable(),
        notes: z.string().max(1000).nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { q, supabaseAdmin, isOwner } = await loadAccessible(data.quoteId, context.userId);
    if (!isOwner) throw new Error("Only the vehicle owner or driver can record the inspection.");
    for (const p of Object.values(data.photos)) {
      if (!p.startsWith(`${context.userId}/inspection-`) || p.includes("..")) throw new Error("Invalid photo upload.");
    }
    const { error } = await supabaseAdmin
      .from("hire_quotes")
      .update({
        inspection_photos: data.photos,
        inspection_at: new Date().toISOString(),
        inspection_odometer: data.odometer,
        inspection_fuel: data.fuel,
        inspection_notes: data.notes,
      })
      .eq("id", q.id);
    if (error) throw new Error(`Could not save inspection: ${error.message}`);
    return { ok: true };
  });

/** Email the hirer a link to their agreement; copy stays in their booking history. */
export const emailHireAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ quoteId: z.string().uuid(), email: z.string().trim().email().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { q, supabaseAdmin } = await loadAccessible(data.quoteId, context.userId);
    const { data: renter } = await supabaseAdmin.from("profiles").select("full_name, email").eq("id", q.requester_id).maybeSingle();
    const to = data.email ?? q.business_email ?? q.contact_email ?? renter?.email;
    if (!to) throw new Error("Add an email address to receive the agreement.");
    const { data: vehicle } = q.vehicle_id
      ? await supabaseAdmin.from("vehicles").select("make, model, plate_number").eq("id", q.vehicle_id).maybeSingle()
      : { data: null };
    const { data: s } = await supabaseAdmin.from("hire_payment_settlements").select("mpesa_receipt").eq("hire_quote_id", q.id).limit(1);
    const end = q.end_at ?? new Date(new Date(q.start_at).getTime() + q.days * 86_400_000).toISOString();
    const { sendTransactionalEmail } = await import("./comms.server");
    const result = await sendTransactionalEmail({
      to,
      template: {
        code: "hire_agreement",
        data: {
          name: q.renter_name ?? renter?.full_name ?? "Customer",
          reference: q.reference,
          vehicle: vehicle ? `${[vehicle.make, vehicle.model].filter(Boolean).join(" ")} (${vehicle.plate_number})` : "Vehicle",
          period: `${new Date(q.start_at).toLocaleString("en-KE")} – ${new Date(end).toLocaleString("en-KE")}`,
          total: `KES ${Number(q.quoted_total ?? q.estimated_total).toLocaleString("en-KE")}`,
          mpesaReceipt: s?.[0]?.mpesa_receipt ?? null,
          link: `https://twenderides.lovable.app/hire/agreement/${q.id}`,
        },
      },
      eventType: "hire_agreement_email",
      idempotencyKey: `agreement:${q.id}:${to}:${Date.now()}`,
      context: { userId: context.userId },
    });
    if (!result.sent) throw new Error(result.detail ?? "Email could not be sent.");
    await supabaseAdmin.from("hire_quotes").update({ agreement_emailed_at: new Date().toISOString() }).eq("id", q.id);
    return { to };
  });

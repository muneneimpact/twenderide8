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
  return { q, supabaseAdmin, isRenter, isOwner: owned || isStaff, isVehicleOwner: owned, isStaff };
}

/** Everything the printable hire agreement needs, auto-filled from the booking. */
export const getHireAgreement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ quoteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const acc = await loadAccessible(data.quoteId, context.userId);
    const { supabaseAdmin, isOwner, isRenter } = acc;
    const { autoSignOwner } = await import("./agreements.server");
    await autoSignOwner(acc.q.id).catch(() => undefined);
    const { data: fresh } = await supabaseAdmin.from("hire_quotes").select("*").eq("id", acc.q.id).maybeSingle();
    const q = fresh ?? acc.q;
    const booked =
      Number(q.payment_paid_total ?? 0) > 0 ||
      q.payment_status === "paid" ||
      Boolean(q.pay_later_method);
    if (!booked && !isOwner) {
      throw new Error("Your agreement is ready once you pay and your booking is confirmed.");
    }
    const [{ data: renter }, { data: vehicle }, { data: settlements }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name, phone, email, id_number").eq("id", q.requester_id).maybeSingle(),
      q.vehicle_id
        ? supabaseAdmin.from("vehicles").select("make, model, plate_number, colour, seats, vehicle_class, owner_driver_id, hire_rules, hire_insurance_details").eq("id", q.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("hire_payment_settlements").select("mpesa_receipt, gross_amount, created_at").eq("hire_quote_id", q.id).order("created_at"),
    ]);
    const v = vehicle as {
      make: string | null; model: string | null; plate_number: string; colour: string | null; seats: number | null;
      vehicle_class: string | null; owner_driver_id: string | null; hire_rules: string | null; hire_insurance_details: string | null;
    } | null;
    let owner: { full_name: string | null; phone: string | null } | null = null;
    if (v?.owner_driver_id) {
      const { data: p } = await supabaseAdmin.from("profiles").select("full_name, phone").eq("id", v.owner_driver_id as string).maybeSingle();
      owner = p ?? null;
    }
    const rawPhotos = (q.inspection_photos ?? {}) as Record<string, unknown>;
    const rawExtras = (Array.isArray(rawPhotos["extras"]) ? rawPhotos["extras"] : []) as Array<{ name: string; path: string }>;
    const photos = Object.fromEntries(Object.entries(rawPhotos).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const paths = [...Object.values(photos), ...rawExtras.map((e) => e.path)].filter(Boolean);
    const signed = paths.length
      ? (await supabaseAdmin.storage.from("hire-documents").createSignedUrls(paths, 1800)).data ?? []
      : [];
    const urlOf = (p: string) => signed.find((s) => s.path === p)?.signedUrl ?? null;
    const sig = q.agreement_signature?.trim() ?? null;
    const { data: brand } = await supabaseAdmin.from("document_branding").select("*").eq("key", "default").maybeSingle();
    const { data: logs } = await supabaseAdmin
      .from("agreement_logs")
      .select("action, created_at, detail")
      .eq("hire_quote_id", q.id)
      .order("created_at");
    const hasOwner = Boolean(v?.owner_driver_id);
    return {
      branding: brand,
      logs: logs ?? [],
      role: {
        isRenter,
        canSignAsHirer: isRenter && !sig,
        canSignAsOwner: (acc.isVehicleOwner || (acc.isStaff && !hasOwner)) && !q.owner_signed_at,
      },
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
        signed_at: q.agreement_signed_at ?? (sig ? q.rules_accepted_at : null),
        owner_signer: q.owner_signer_name,
        owner_signature: q.owner_signature,
        owner_signed_at: q.owner_signed_at,
        completed_at: q.agreement_completed_at,
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
      extraPhotos: rawExtras.map((e) => ({ name: e.name, url: urlOf(e.path) })),
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
        extras: z.array(z.object({ name: z.string().trim().min(1).max(60), path: z.string() })).max(20).default([]),
        odometer: z.number().int().min(0).max(5_000_000).nullable(),
        fuel: z.string().max(40).nullable(),
        notes: z.string().max(1000).nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { q, supabaseAdmin, isOwner } = await loadAccessible(data.quoteId, context.userId);
    if (!isOwner) throw new Error("Only the vehicle owner or driver can record the inspection.");
    for (const p of [...Object.values(data.photos), ...data.extras.map((e) => e.path)]) {
      if (!p.startsWith(`${context.userId}/inspection-`) || p.includes("..")) throw new Error("Invalid photo upload.");
    }
    const { error } = await supabaseAdmin
      .from("hire_quotes")
      .update({
        inspection_photos: { ...data.photos, extras: data.extras },
        inspection_at: new Date().toISOString(),
        inspection_odometer: data.odometer,
        inspection_fuel: data.fuel,
        inspection_notes: data.notes,
      })
      .eq("id", q.id);
    if (error) throw new Error(`Could not save inspection: ${error.message}`);
    const { data: renter } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", q.requester_id)
      .maybeSingle();
    const renterPhone = q.contact_phone ?? renter?.phone;
    if (renterPhone) {
      const { sendTransactionalSms } = await import("./comms.server");
      await sendTransactionalSms({
        to: renterPhone,
        message: `Twende Ride: handover details for booking ${q.reference} were updated with vehicle readings and photos. Review the latest agreement here: https://twenderide8.lovable.app/hire/agreement/${q.id}`,
        eventType: "hire_handover_updated",
        idempotencyKey: `hire-handover:${q.id}:${data.photos.front}:${data.odometer ?? "na"}:${data.fuel ?? "na"}`,
        context: { userId: context.userId },
      });
    }
    return { ok: true };
  });

/** Email the hirer a link to their agreement; copy stays in their booking history. */
export const emailHireAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ quoteId: z.string().uuid(), email: z.string().trim().email().optional(), pdfBase64: z.string().max(8_000_000).optional() }).parse(i))
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
          link: `https://twenderide8.lovable.app/hire/agreement/${q.id}`,
        },
      },
      eventType: "hire_agreement_email",
      idempotencyKey: `agreement:${q.id}:${to}:${Date.now()}`,
      context: { userId: context.userId },
      attachments: data.pdfBase64 ? [{ filename: `Twende-hire-agreement-${q.reference}.pdf`, content: data.pdfBase64 }] : undefined,
    });
    if (!result.sent) throw new Error(result.detail ?? "Email could not be sent.");
    await supabaseAdmin.from("hire_quotes").update({ agreement_emailed_at: new Date().toISOString() }).eq("id", q.id);
    return { to };
  });

/** Hirer or owner signs the agreement (drawn image or typed name). */
export const signHireAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        quoteId: z.string().uuid(),
        as: z.enum(["hirer", "owner"]),
        signerName: z.string().trim().min(2).max(120),
        signature: z.string().min(3).max(400_000),
        saveForLater: z.boolean().optional(),
        autoSign: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const acc = await loadAccessible(data.quoteId, context.userId);
    const { q, supabaseAdmin } = acc;
    if (!data.signature.startsWith("data:image/png") && !data.signature.startsWith("typed:")) throw new Error("Invalid signature.");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const meta = { userAgent: getRequestHeader("user-agent") ?? null, ip: getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? null };
    const now = new Date().toISOString();
    const { logAgreement, completeIfBothSigned } = await import("./agreements.server");
    if (data.as === "hirer") {
      if (!acc.isRenter) throw new Error("Only the hirer can sign here.");
      if (q.agreement_signature) throw new Error("You already signed.");
      await supabaseAdmin.from("hire_quotes").update({ agreement_signature: data.signature, agreement_signer_name: data.signerName, agreement_signed_at: now }).eq("id", q.id);
    } else {
      const { data: v } = q.vehicle_id ? await supabaseAdmin.from("vehicles").select("owner_driver_id").eq("id", q.vehicle_id).maybeSingle() : { data: null };
      const allowed = acc.isVehicleOwner || (acc.isStaff && !v?.owner_driver_id);
      if (!allowed) throw new Error("Only the vehicle owner can sign here.");
      if (q.owner_signed_at) throw new Error("Already signed by the owner.");
      await supabaseAdmin.from("hire_quotes").update({ owner_signature: data.signature, owner_signer_name: data.signerName, owner_signed_at: now, owner_signed_by: context.userId }).eq("id", q.id);
      if (data.saveForLater) {
        await supabaseAdmin.from("owner_signatures").upsert({ user_id: context.userId, signer_name: data.signerName, signature: data.signature, auto_sign: Boolean(data.autoSign), updated_at: now });
      }
    }
    await logAgreement(q.id, context.userId, `${data.as}_signed`, { signer: data.signerName, kind: data.signature.startsWith("typed:") ? "typed" : "drawn" }, meta);
    await completeIfBothSigned(q.id);
    return { ok: true };
  });

/** Hire payment receipt data (every settled payment on the booking). */
export const getHireReceipt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ quoteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { q, supabaseAdmin } = await loadAccessible(data.quoteId, context.userId);
    const [{ data: s }, { data: brand }, { data: vehicle }, { data: renter }] = await Promise.all([
      supabaseAdmin.from("hire_payment_settlements").select("mpesa_receipt, gross_amount, created_at").eq("hire_quote_id", q.id).order("created_at"),
      supabaseAdmin.from("document_branding").select("*").eq("key", "default").maybeSingle(),
      q.vehicle_id ? supabaseAdmin.from("vehicles").select("make, model, plate_number").eq("id", q.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
      supabaseAdmin.from("profiles").select("full_name, phone, company_name, company_kra_pin, company_registration_number").eq("id", q.requester_id).maybeSingle(),
    ]);
    const end = q.end_at ?? new Date(new Date(q.start_at).getTime() + q.days * 86_400_000).toISOString();
    // Company bookings are billed to the company, not the person who clicked book.
    const isCompany = q.hirer_type === "company";
    const companyName = q.organisation ?? renter?.company_name ?? null;
    const billedTo = isCompany && companyName ? companyName : (q.renter_name ?? renter?.full_name ?? "Customer");
    const billingLines: [string, string][] = isCompany && companyName
      ? [
          ["Billed to (company)", companyName],
          ...(q.business_registration_number || renter?.company_registration_number
            ? [["Registration no.", q.business_registration_number ?? renter?.company_registration_number ?? ""] as [string, string]]
            : []),
          ...(q.contact_name ? [["Contact person", q.contact_name] as [string, string]] : []),
        ]
      : [];
    return {
      branding: brand,
      receipt: {
        kind: "hire" as const,
        reference: q.reference,
        customer: billedTo,
        phone: q.contact_phone ?? renter?.phone ?? null,
        lines: [
          ...billingLines,
          ["Vehicle", vehicle ? `${[vehicle.make, vehicle.model].filter(Boolean).join(" ")} (${vehicle.plate_number})` : "Vehicle"],
          ["Mode", q.drive_mode === "self_drive" ? "Self drive" : "Chauffeured"],
          ["Period", `${new Date(q.start_at).toLocaleString("en-KE")} - ${new Date(end).toLocaleString("en-KE")}`],
          ["Days", String(q.days)],
          ["Pick-up point", q.pickup_label ?? "-"],
        ] as [string, string][],
        total: Number(q.quoted_total ?? q.estimated_total),
        paid: Number(q.payment_paid_total ?? 0),
        payments: (s ?? []).map((p) => ({ code: p.mpesa_receipt, amount: Number(p.gross_amount), at: p.created_at, method: "M-PESA" })),
        issuedAt: new Date().toISOString(),
      },
    };
  });

/**
 * The hirer's own pickup / return readings (odometer, fuel, notes, camera photos).
 * Kept separately from the owner's walkaround so both sides have their own proof.
 * Each save is appended to history; nothing earlier is overwritten.
 */
export const saveHirerVehicleDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        quoteId: z.string().uuid(),
        stage: z.enum(["pickup", "return"]),
        odometer: z.number().int().min(0).max(5_000_000),
        fuel: z.string().max(40),
        notes: z.string().max(1000).nullable(),
        photos: z.array(z.object({ name: z.string().trim().min(1).max(60), path: z.string() })).max(12).default([]),
        device: z.string().max(300).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { q, supabaseAdmin, isRenter } = await loadAccessible(data.quoteId, context.userId);
    if (!isRenter) throw new Error("Only the hirer can add these details.");
    const booked = Number(q.payment_paid_total ?? 0) > 0 || q.payment_status === "paid" || (q.status === "confirmed" && !!q.pay_later_method);
    if (!booked) throw new Error("Add pickup details once your booking is paid or confirmed.");
    for (const p of data.photos) {
      if (!p.path.startsWith(`${context.userId}/hirer-${data.quoteId}-`) || p.path.includes("..")) throw new Error("Invalid photo upload.");
    }
    const prev = (q.hirer_inspection ?? {}) as Record<string, unknown>;
    const pickup = prev["pickup"] as { odometer?: number } | undefined;
    if (data.stage === "return" && pickup?.odometer != null && data.odometer < pickup.odometer) {
      throw new Error(`Return odometer can't be below pickup (${pickup.odometer} km).`);
    }
    const entry = { odometer: data.odometer, fuel: data.fuel, notes: data.notes, photos: data.photos, at: new Date().toISOString(), device: data.device ?? null, by: context.userId };
    const history = Array.isArray(prev["history"]) ? (prev["history"] as unknown[]) : [];
    const next = { ...prev, [data.stage]: entry, history: [...history, { stage: data.stage, ...entry }].slice(-40) };
    const { error } = await supabaseAdmin.from("hire_quotes").update({ hirer_inspection: next as never }).eq("id", q.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

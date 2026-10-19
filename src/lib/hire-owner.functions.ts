/**
 * Owner/driver side of car hire: see booked days, hand over and receive cars,
 * decline untrusted hires inside the due-diligence window. Also business-email
 * verification codes for company bookings.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { canOwnerDecline } from "./hire-rules";

export interface OwnerBooking {
  id: string;
  reference: string;
  vehicle: string;
  renter: string;
  renter_phone: string | null;
  hirer_type: string;
  drive_mode: string;
  start_at: string;
  end_at: string | null;
  days: number;
  status: string;
  payment_status: string;
  total: number;
  paid: number;
  pay_later: string | null;
  handed_over_at: string | null;
  returned_at: string | null;
  can_decline: boolean;
  has_documents: boolean;
  owner_signed: boolean;
  hirer_signed: boolean;
  agreement_completed: boolean;
}

async function loadBookingFor(userId: string, quoteId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { ownedVehicleIds } = await import("./hire-owner.server");
  const { data: q } = await supabaseAdmin.from("hire_quotes").select("*").eq("id", quoteId).maybeSingle();
  if (!q) throw new Error("Booking not found.");
  const owned = await ownedVehicleIds(userId);
  if (!(q.vehicle_id && owned.includes(q.vehicle_id)) && q.assigned_driver_id !== userId)
    throw new Error("This booking is not for your car.");
  return q;
}

export const listOwnerBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerBooking[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ownedVehicleIds } = await import("./hire-owner.server");
    const ids = await ownedVehicleIds(context.userId);
    const filter = ids.length
      ? `vehicle_id.in.(${ids.join(",")}),assigned_driver_id.eq.${context.userId}`
      : `assigned_driver_id.eq.${context.userId}`;
    const { data: rows } = await supabaseAdmin
      .from("hire_quotes")
      .select("*")
      .or(filter)
      .in("status", ["confirmed", "submitted", "quoted"])
      .order("start_at", { ascending: true })
      .limit(300);
    const list = (rows ?? []).filter(
      (r) => r.status === "confirmed" || ["paid", "partial"].includes(r.payment_status ?? ""),
    );
    const vIds = [...new Set(list.map((r) => r.vehicle_id).filter((x): x is string => Boolean(x)))];
    const { data: vehicles } = vIds.length
      ? await supabaseAdmin.from("vehicles").select("id, make, model, plate_number").in("id", vIds)
      : { data: [] as Array<{ id: string; make: string | null; model: string | null; plate_number: string }> };
    const vmap = new Map((vehicles ?? []).map((v) => [v.id, `${[v.make, v.model].filter(Boolean).join(" ")} ${v.plate_number}`.trim()]));
    return list.map((r) => ({
      id: r.id,
      reference: r.reference,
      vehicle: (r.vehicle_id && vmap.get(r.vehicle_id)) || r.vehicle_class,
      renter: r.organisation || r.renter_name || r.contact_name || "Customer",
      renter_phone: r.status === "confirmed" ? r.contact_phone : null,
      hirer_type: r.hirer_type ?? "individual",
      drive_mode: r.drive_mode,
      start_at: r.start_at,
      end_at: r.end_at,
      days: r.days,
      status: r.status,
      payment_status: r.payment_status ?? "pending",
      total: Number(r.quoted_total ?? r.estimated_total),
      paid: Number(r.payment_paid_total ?? 0),
      pay_later: r.pay_later_method ? `${r.pay_later_method.replace("_", " ")} by ${r.pay_later_due_date}` : null,
      handed_over_at: r.handed_over_at,
      returned_at: r.returned_at,
      can_decline:
        !r.handed_over_at &&
        canOwnerDecline({ startAt: new Date(r.start_at), bookedAt: new Date(r.created_at) }),
      has_documents: Boolean(r.id_document_path),
      owner_signed: Boolean(r.owner_signed_at),
      hirer_signed: Boolean(r.agreement_signed_at),
      agreement_completed: Boolean(r.agreement_completed_at),
    }));
  });

export const markHireHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ quoteId: z.string().uuid(), step: z.enum(["handed_over", "returned"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const q = await loadBookingFor(context.userId, data.quoteId);
    if (q.status !== "confirmed") throw new Error("Only confirmed bookings can be handed over.");
    if (data.step === "returned" && !q.handed_over_at) throw new Error("Mark the handover first.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch = data.step === "handed_over" ? { handed_over_at: new Date().toISOString() } : { returned_at: new Date().toISOString() };
    await supabaseAdmin.from("hire_quotes").update(patch).eq("id", q.id);
    const { notify } = await import("./notifications.server");
    await notify({
      userId: q.requester_id,
      templateCode: `hire_${data.step}`,
      title: data.step === "handed_over" ? "Car handed over" : "Car returned",
      body: `Hire ${q.reference}: ${data.step === "handed_over" ? "the car has been handed over to you. Drive safely!" : "the car has been returned. Thank you for hiring with Twende."}`,
      dedupeKey: `hire-${data.step}:${q.id}`,
    }).catch(() => undefined);
    return { ok: true };
  });

export const ownerDeclineHire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ quoteId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const q = await loadBookingFor(context.userId, data.quoteId);
    if (q.handed_over_at) throw new Error("The car was already handed over.");
    if (!canOwnerDecline({ startAt: new Date(q.start_at), bookedAt: new Date(q.created_at) }))
      throw new Error(
        "Declining closes 12 hours before pickup (or 3 hours after booking for short-notice hires). Contact support.",
      );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const paid = Number(q.payment_paid_total ?? 0);
    await supabaseAdmin
      .from("hire_quotes")
      .update({
        status: "declined",
        owner_declined_at: new Date().toISOString(),
        owner_decline_reason: data.reason,
        payment_status: paid > 0 ? "refund_pending" : q.payment_status,
        payment_hold_expires_at: null,
      })
      .eq("id", q.id);
    const { notify, audit } = await import("./notifications.server");
    await audit(context.userId, "hire_owner_declined", "hire_quote", q.id, { reason: data.reason, paid });
    await notify({
      userId: q.requester_id,
      templateCode: "hire_owner_declined",
      title: "Hire booking declined by the owner",
      body: `Hire ${q.reference} was declined by the car owner.${paid > 0 ? ` Your KES ${paid.toLocaleString("en-KE")} will be refunded by Twende.` : ""} Please choose another car.`,
      critical: true,
      dedupeKey: `hire-owner-declined:${q.id}`,
    }).catch(() => undefined);
    return { ok: true };
  });

export const sendBusinessEmailCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ email: z.string().trim().email().max(160) }).parse(input))
  .handler(async ({ data, context }) => {
    const { isBusinessEmail } = await import("./hire-rules");
    const email = data.email.toLowerCase();
    if (!isBusinessEmail(email))
      throw new Error("Use your company email (e.g. name@company.co.ke), not Gmail or Yahoo.");
    const { randomOtp, hashOtp } = await import("./otp.server");
    const code = randomOtp();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("business_email_otps").insert({
      user_id: context.userId,
      email,
      code_hash: await hashOtp(code, `${context.userId}:${email}`),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    const { sendEmail } = await import("./adapters/messaging.server");
    const result = await sendEmail({
      to: email,
      subject: "Your Twende business verification code",
      body: `Your Twende Meru Rides business verification code is ${code}. It expires in 15 minutes.`,
      templateCode: "business_email_otp",
    });
    if (!result.delivered) throw new Error(result.message);
    return { ok: true };
  });

export const verifyBusinessEmailCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ email: z.string().trim().email(), code: z.string().regex(/^\d{6}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const email = data.email.toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("business_email_otps")
      .select("*")
      .eq("user_id", context.userId)
      .eq("email", email)
      .is("verified_at", null)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row) throw new Error("The code expired. Send a new one.");
    if (row.attempts >= 5) throw new Error("Too many attempts. Send a new code.");
    const { hashOtp } = await import("./otp.server");
    if ((await hashOtp(data.code, `${context.userId}:${email}`)) !== row.code_hash) {
      await supabaseAdmin.from("business_email_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      throw new Error("That code is not correct.");
    }
    await supabaseAdmin.from("business_email_otps").update({ verified_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: true };
  });

/** Owner applies their saved signature to a booked hire (works for earlier hires too). */
export const ownerApplySavedSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quoteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const q = await loadBookingFor(context.userId, data.quoteId);
    if (q.owner_signed_at) return { ok: true, already: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sig } = await supabaseAdmin.from("owner_signatures").select("signer_name, signature").eq("user_id", context.userId).maybeSingle();
    if (!sig?.signature) throw new Error("Create your signature first (Bookings → My signature).");
    const now = new Date().toISOString();
    await supabaseAdmin.from("hire_quotes").update({ owner_signature: sig.signature, owner_signer_name: sig.signer_name, owner_signed_at: now, owner_signed_by: context.userId }).eq("id", q.id);
    const { logAgreement, completeIfBothSigned } = await import("./agreements.server");
    await logAgreement(q.id, context.userId, "owner_signed", { signer: sig.signer_name, kind: "saved", via: "bookings_list" }, { userAgent: null, ip: null });
    await completeIfBothSigned(q.id);
    return { ok: true, already: false };
  });

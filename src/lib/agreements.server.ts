/** Server-only helpers for dual-signed hire agreements and their audit log. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

export async function logAgreement(
  quoteId: string,
  actorId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
  meta: { userAgent?: string | null; ip?: string | null } = {},
) {
  await supabaseAdmin.from("agreement_logs").insert({
    hire_quote_id: quoteId,
    actor_id: actorId,
    action,
    detail: detail as Json,
    user_agent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
}

/** Owner of the hired vehicle (user id), if any. */
export async function vehicleOwnerId(vehicleId: string | null): Promise<string | null> {
  if (!vehicleId) return null;
  const { data } = await supabaseAdmin.from("vehicles").select("owner_driver_id").eq("id", vehicleId).maybeSingle();
  return (data?.owner_driver_id as string | null) ?? null;
}

/** If the owner turned on auto-sign, sign the agreement on their behalf. */
export async function autoSignOwner(quoteId: string) {
  const { data: q } = await supabaseAdmin
    .from("hire_quotes")
    .select("id, vehicle_id, owner_signed_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (!q || q.owner_signed_at) return;
  const ownerId = await vehicleOwnerId(q.vehicle_id);
  if (!ownerId) return;
  const { data: sig } = await supabaseAdmin.from("owner_signatures").select("*").eq("user_id", ownerId).maybeSingle();
  if (!sig?.auto_sign) return;
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("hire_quotes")
    .update({ owner_signature: sig.signature, owner_signer_name: sig.signer_name, owner_signed_at: now, owner_signed_by: ownerId })
    .eq("id", quoteId)
    .is("owner_signed_at", null);
  await logAgreement(quoteId, ownerId, "owner_auto_signed", { signer: sig.signer_name });
  await completeIfBothSigned(quoteId);
}

/** When hirer and owner have both signed: mark complete, log, email both parties. */
export async function completeIfBothSigned(quoteId: string) {
  const { data: q } = await supabaseAdmin.from("hire_quotes").select("*").eq("id", quoteId).maybeSingle();
  if (!q || q.agreement_completed_at) return;
  if (!q.agreement_signature || !q.owner_signed_at) return;
  const now = new Date().toISOString();
  const { data: updated } = await supabaseAdmin
    .from("hire_quotes")
    .update({ agreement_completed_at: now })
    .eq("id", quoteId)
    .is("agreement_completed_at", null)
    .select("id");
  if (!updated?.length) return;
  await logAgreement(quoteId, null, "agreement_completed", { at: now });

  const ownerId = await vehicleOwnerId(q.vehicle_id);
  const [{ data: renter }, { data: owner }, { data: vehicle }, { data: s }] = await Promise.all([
    supabaseAdmin.from("profiles").select("full_name, email").eq("id", q.requester_id).maybeSingle(),
    ownerId ? supabaseAdmin.from("profiles").select("full_name, email").eq("id", ownerId).maybeSingle() : Promise.resolve({ data: null }),
    q.vehicle_id ? supabaseAdmin.from("vehicles").select("make, model, plate_number").eq("id", q.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    supabaseAdmin.from("hire_payment_settlements").select("mpesa_receipt").eq("hire_quote_id", q.id).limit(1),
  ]);
  const end = q.end_at ?? new Date(new Date(q.start_at).getTime() + q.days * 86_400_000).toISOString();
  const base = {
    reference: q.reference,
    vehicle: vehicle ? `${[vehicle.make, vehicle.model].filter(Boolean).join(" ")} (${vehicle.plate_number})` : "Vehicle",
    period: `${new Date(q.start_at).toLocaleString("en-KE")} – ${new Date(end).toLocaleString("en-KE")}`,
    total: `KES ${Number(q.quoted_total ?? q.estimated_total).toLocaleString("en-KE")}`,
    mpesaReceipt: s?.[0]?.mpesa_receipt ?? null,
    link: `https://twenderides.lovable.app/hire/agreement/${q.id}`,
  };
  const { sendTransactionalEmail } = await import("./comms.server");
  const recipients = [
    { to: q.business_email ?? q.contact_email ?? renter?.email, name: q.renter_name ?? renter?.full_name ?? "Customer", role: "hirer", uid: q.requester_id },
    { to: owner?.email ?? null, name: owner?.full_name ?? "Owner", role: "owner", uid: ownerId },
  ];
  for (const r of recipients) {
    if (!r.to) continue;
    const result = await sendTransactionalEmail({
      to: r.to,
      template: { code: "hire_agreement", data: { ...base, name: r.name } },
      eventType: "hire_agreement_email",
      idempotencyKey: `agreement-complete:${q.id}:${r.role}`,
      context: { userId: r.uid ?? null },
    }).catch((e) => ({ sent: false, detail: (e as Error).message }));
    await logAgreement(quoteId, null, result.sent ? "emailed" : "email_failed", { to: r.to, role: r.role });
  }
  await supabaseAdmin.from("hire_quotes").update({ agreement_emailed_at: new Date().toISOString() }).eq("id", quoteId);
}

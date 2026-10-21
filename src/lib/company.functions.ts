import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const KRA = /^[AP]\d{9}[A-Z]$/;

/** Record one company-details change so admins can review the full edit trail. */
async function logKycEdit(
  userId: string,
  entry: { action: string; field?: string; oldValue?: string | null; newValue?: string | null },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    await supabaseAdmin.from("business_kyc_edits").insert({
      user_id: userId,
      actor_id: userId,
      action: entry.action,
      field: entry.field ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
    });
  } catch {
    // The edit trail is best-effort; never block the actual change.
  }
}

/** Company details + saved KYC documents stored on the account (works on any phone). */
export const getCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: p }, { data: docs }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("company_name, company_kra_pin, company_billing_email, company_registration_number")
        .eq("id", context.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("business_kyc_documents")
        .select("document_kind, file_path, updated_at")
        .eq("user_id", context.userId),
    ]);
    const documents = await Promise.all(
      (docs ?? []).map(async (d) => {
        const { data: s } = await supabaseAdmin.storage.from("hire-documents").createSignedUrl(d.file_path, 3600);
        return { kind: d.document_kind, uploadedAt: d.updated_at, url: s?.signedUrl ?? null };
      }),
    );
    return {
      companyName: p?.company_name ?? "",
      kraPin: p?.company_kra_pin ?? "",
      billingEmail: p?.company_billing_email ?? "",
      registrationNumber: p?.company_registration_number ?? "",
      documents,
    };
  });

export const updateCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyName: z.string().trim().min(2).max(160),
        kraPin: z.string().trim().toUpperCase().regex(KRA, "Enter a valid KRA PIN, e.g. P051234567X.").or(z.literal("")),
        billingEmail: z.string().trim().email().or(z.literal("")),
        registrationNumber: z.string().trim().max(80),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("company_name, company_kra_pin, company_billing_email, company_registration_number")
      .eq("id", context.userId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        company_name: data.companyName,
        company_kra_pin: data.kraPin || null,
        company_billing_email: data.billingEmail || null,
        company_registration_number: data.registrationNumber || null,
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    const diffs: Array<[string, string | null, string | null]> = [
      ["company_name", before?.company_name ?? null, data.companyName],
      ["company_kra_pin", before?.company_kra_pin ?? null, data.kraPin || null],
      ["company_billing_email", before?.company_billing_email ?? null, data.billingEmail || null],
      ["company_registration_number", before?.company_registration_number ?? null, data.registrationNumber || null],
    ];
    for (const [field, oldValue, newValue] of diffs) {
      if ((oldValue ?? "") !== (newValue ?? "")) {
        await logKycEdit(context.userId, {
          action: before?.company_name ? "profile_updated" : "profile_created",
          field,
          oldValue,
          newValue,
        });
      }
    }
    return { ok: true };
  });

async function removeDocs(userId: string, kinds?: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin.from("business_kyc_documents").select("document_kind, file_path").eq("user_id", userId);
  if (kinds) q = q.in("document_kind", kinds);
  const { data } = await q;
  const paths = (data ?? []).map((d) => d.file_path).filter((p) => p.startsWith(`${userId}/`));
  // Files still attached to a booking stay for the owner; only the saved copy record is removed.
  let del = supabaseAdmin.from("business_kyc_documents").delete().eq("user_id", userId);
  if (kinds) del = del.in("document_kind", kinds);
  const { error } = await del;
  if (error) throw new Error(error.message);
  return paths;
}

export const deleteCompanyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ kind: z.enum(["certificate", "kra_pin", "cr12", "other"]) }).parse(i))
  .handler(async ({ data, context }) => {
    await removeDocs(context.userId, [data.kind]);
    await logKycEdit(context.userId, { action: "document_deleted", field: data.kind });
    return { ok: true };
  });

/** Wipe saved company details and saved documents from the account. */
export const deleteCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("company_name")
      .eq("id", context.userId)
      .maybeSingle();
    await removeDocs(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ company_name: null, company_kra_pin: null, company_billing_email: null, company_registration_number: null })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    await logKycEdit(context.userId, {
      action: "profile_deleted",
      field: "company_name",
      oldValue: before?.company_name ?? null,
    });
    return { ok: true };
  });

/** ETR state for each of my hires, with a download link once finance attaches it. */
export const listMyHireEtr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("hire_etr_requests").select("*").eq("requester_id", context.userId);
    return Promise.all(
      (data ?? []).map(async (r) => {
        let url: string | null = null;
        if (r.file_path) {
          const { data: s } = await supabaseAdmin.storage.from("etr-documents").createSignedUrl(r.file_path, 3600);
          url = s?.signedUrl ?? null;
        }
        return { quoteId: r.hire_quote_id, status: r.status, companyName: r.company_name, url };
      }),
    );
  });

export const requestHireEtr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ quoteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: q }, { data: p }] = await Promise.all([
      supabaseAdmin
        .from("hire_quotes")
        .select("id, reference, requester_id, payment_paid_total, payment_status")
        .eq("id", data.quoteId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("company_name, company_kra_pin, company_billing_email")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);
    if (!q || q.requester_id !== context.userId) throw new Error("Booking not found.");
    if (!(Number(q.payment_paid_total ?? 0) > 0)) throw new Error("An ETR can be requested once a payment has been made.");
    if (!p?.company_name || !p.company_kra_pin) throw new Error("Add your company name and KRA PIN in Company details first.");
    const { error } = await supabaseAdmin.from("hire_etr_requests").upsert(
      {
        hire_quote_id: q.id,
        requester_id: context.userId,
        company_name: p.company_name,
        kra_pin: p.company_kra_pin,
        billing_email: p.company_billing_email,
        status: "requested",
      },
      { onConflict: "hire_quote_id" },
    );
    if (error) throw new Error(error.message);
    const { textStaffWithLink } = await import("./links.server");
    await textStaffWithLink(["finance_admin", "super_admin"], {
      message: `Twende: ${p.company_name} (KRA ${p.company_kra_pin}) requested an ETR for car hire ${q.reference}, KES ${Number(q.payment_paid_total).toLocaleString()} paid. Attach it here:`,
      path: "/admin/finance#etr",
      eventType: "etr_requested",
      idempotencyKey: `hire-etr-req:${q.id}:${Date.now()}`,
    }).catch(() => null);
    return { ok: true };
  });

export const listHireEtrQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("hire_etr_requests").select("*").order("created_at", { ascending: false }).limit(200);
    const ids = (data ?? []).map((r) => r.hire_quote_id);
    const { data: qs } = ids.length
      ? await supabaseAdmin.from("hire_quotes").select("id, reference, payment_paid_total").in("id", ids)
      : { data: [] as Array<{ id: string; reference: string; payment_paid_total: number | null }> };
    return (data ?? []).map((r) => {
      const q = (qs ?? []).find((x) => x.id === r.hire_quote_id);
      return {
        id: r.id, status: r.status, company_name: r.company_name, kra_pin: r.kra_pin,
        created_at: r.created_at, uploaded_at: r.uploaded_at,
        reference: q?.reference ?? "", paid: Number(q?.payment_paid_total ?? 0),
      };
    });
  });

export const uploadHireEtr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ requestId: z.string().uuid(), pdfBase64: z.string().min(10).max(14_000_000) }).parse(i))
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin.from("hire_etr_requests").select("*").eq("id", data.requestId).maybeSingle();
    if (!req) throw new Error("ETR request not found.");
    const bin = Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0));
    if (String.fromCharCode(...bin.subarray(0, 4)) !== "%PDF") throw new Error("Attach a PDF file.");
    const path = `hire/${req.hire_quote_id}/etr-${Date.now()}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage.from("etr-documents").upload(path, bin, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);
    await supabaseAdmin.from("hire_etr_requests").update({
      file_path: path, status: "sent", uploaded_by: context.userId, uploaded_at: new Date().toISOString(),
    }).eq("id", req.id);
    const { data: q } = await supabaseAdmin.from("hire_quotes").select("reference").eq("id", req.hire_quote_id).maybeSingle();
    const { textUserWithLink } = await import("./links.server");
    await textUserWithLink({
      userId: req.requester_id,
      message: `Twende: your ETR for car hire ${q?.reference ?? ""} is ready. Download it here:`,
      path: "/hire/bookings",
      eventType: "etr_sent",
      idempotencyKey: `hire-etr-sent:${req.id}:${Date.now()}`,
    }).catch(() => null);
    return { ok: true };
  });

/** Staff view of every company-details / KYC change, newest first. */
export const listCompanyKycEdits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("business_kyc_edits")
      .select("id, user_id, action, field, old_value, new_value, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const ids = [...new Set((data ?? []).map((r) => r.user_id))];
    const { data: profiles } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, phone, company_name").in("id", ids)
      : { data: [] as Array<{ id: string; full_name: string | null; phone: string | null; company_name: string | null }> };
    return (data ?? []).map((r) => {
      const p = (profiles ?? []).find((x) => x.id === r.user_id);
      return {
        id: r.id,
        action: r.action,
        field: r.field,
        oldValue: r.old_value,
        newValue: r.new_value,
        createdAt: r.created_at,
        userName: p?.full_name ?? "Unknown",
        userPhone: p?.phone ?? "",
        companyName: p?.company_name ?? "",
      };
    });
  });

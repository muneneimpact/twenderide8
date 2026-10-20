import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Company billing details saved on the account (not the device) for reuse. */
export const getMyCompanyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("company_name, company_kra_pin, company_billing_email, email")
      .eq("id", context.userId)
      .maybeSingle();
    return {
      companyName: data?.company_name ?? "",
      kraPin: data?.company_kra_pin ?? "",
      billingEmail: data?.company_billing_email ?? data?.email ?? "",
    };
  });

/** ETR state for one of the caller's rides, with a short-lived download link once sent. */
export const getRideEtr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ rideId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("etr_requests").select("*").eq("ride_id", data.rideId).eq("requester_id", context.userId).maybeSingle();
    if (!row) return null;
    let url: string | null = null;
    if (row.file_path) {
      const { data: signed } = await supabaseAdmin.storage.from("etr-documents").createSignedUrl(row.file_path, 3600);
      url = signed?.signedUrl ?? null;
    }
    return { status: row.status, companyName: row.company_name, kraPin: row.kra_pin, url, uploadedAt: row.uploaded_at };
  });

export const requestRideEtr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      rideId: z.string().uuid(),
      companyName: z.string().trim().min(2).max(160),
      kraPin: z.string().trim().toUpperCase().regex(/^[AP]\d{9}[A-Z]$/, "Enter a valid KRA PIN, e.g. P051234567X."),
      billingEmail: z.string().trim().email().optional().or(z.literal("")),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin
      .from("rides").select("id, reference, customer_id, status").eq("id", data.rideId).maybeSingle();
    if (!ride || ride.customer_id !== context.userId) throw new Error("Trip not found.");
    if (ride.status !== "trip_completed") throw new Error("An ETR can be requested once the trip is completed.");
    const { error } = await supabaseAdmin.from("etr_requests").upsert({
      ride_id: ride.id, requester_id: context.userId, company_name: data.companyName,
      kra_pin: data.kraPin, billing_email: data.billingEmail || null, status: "requested",
    }, { onConflict: "ride_id" });
    if (error) throw new Error(error.message);
    // Saved on the account so every future request is one tap, on any phone.
    await supabaseAdmin.from("profiles").update({
      company_name: data.companyName, company_kra_pin: data.kraPin, company_billing_email: data.billingEmail || null,
    }).eq("id", context.userId);
    const { textStaffWithLink } = await import("./links.server");
    await textStaffWithLink(["finance_admin", "super_admin"], {
      message: `Twende: ${data.companyName} requested an ETR for ride ${ride.reference}. Attach it here:`,
      path: "/admin/finance#etr",
      eventType: "etr_requested",
      idempotencyKey: `etr-req:${ride.id}:${Date.now()}`,
    });
    return { ok: true };
  });

/** Finance / admin queue. */
export const listEtrRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("etr_requests").select("*").order("created_at", { ascending: false }).limit(200);
    const rideIds = (data ?? []).map((r) => r.ride_id);
    const { data: rides } = rideIds.length
      ? await supabaseAdmin.from("rides").select("id, reference, total_fare, completed_at").in("id", rideIds)
      : { data: [] as Array<{ id: string; reference: string; total_fare: number; completed_at: string | null }> };
    return (data ?? []).map((r) => {
      const ride = (rides ?? []).find((x) => x.id === r.ride_id);
      return {
        id: r.id, status: r.status, company_name: r.company_name, kra_pin: r.kra_pin, billing_email: r.billing_email,
        created_at: r.created_at, uploaded_at: r.uploaded_at, reference: ride?.reference ?? "", fare: Number(ride?.total_fare ?? 0),
        completed_at: ride?.completed_at ?? null,
      };
    });
  });

export const uploadEtrDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ requestId: z.string().uuid(), pdfBase64: z.string().min(10).max(14_000_000) }).parse(i))
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req } = await supabaseAdmin.from("etr_requests").select("*").eq("id", data.requestId).maybeSingle();
    if (!req) throw new Error("ETR request not found.");
    const bin = Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0));
    if (String.fromCharCode(...bin.subarray(0, 4)) !== "%PDF") throw new Error("Attach a PDF file.");
    const { data: ride } = await supabaseAdmin.from("rides").select("reference").eq("id", req.ride_id).maybeSingle();
    const path = `${req.ride_id}/etr-${Date.now()}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage.from("etr-documents").upload(path, bin, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);
    await supabaseAdmin.from("etr_requests").update({
      file_path: path, status: "sent", uploaded_by: context.userId, uploaded_at: new Date().toISOString(),
    }).eq("id", req.id);
    const { textUserWithLink } = await import("./links.server");
    await textUserWithLink({
      userId: req.requester_id,
      message: `Twende: your ETR for ride ${ride?.reference ?? ""} is ready. Download it here:`,
      path: `/rides/${req.ride_id}`,
      eventType: "etr_sent",
      idempotencyKey: `etr-sent:${req.id}:${Date.now()}`,
    });
    if (req.billing_email) {
      const { sendTransactionalEmail } = await import("./comms.server");
      await sendTransactionalEmail({
        to: req.billing_email,
        template: {
          code: "custom",
          data: {
            subject: `ETR for Twende ride ${ride?.reference ?? ""}`,
            heading: "Your ETR receipt",
            body: `Attached is the ETR for ${req.company_name} (KRA PIN ${req.kra_pin}), ride ${ride?.reference ?? ""}.`,
          },
        } as never,
        eventType: "etr_sent_email",
        idempotencyKey: `etr-email:${req.id}:${Date.now()}`,
        context: { userId: req.requester_id, rideId: req.ride_id },
        attachments: [{ filename: `Twende-ETR-${ride?.reference ?? req.id}.pdf`, content: data.pdfBase64 }],
      }).catch(() => null);
    }
    return { ok: true };
  });

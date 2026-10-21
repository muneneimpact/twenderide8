/**
 * Admin wallet funding. Every batch needs a KES 1 M-PESA payment from the approver
 * phone (0723175181) followed by the SMS code sent to that phone. Credits are promo
 * (non-refundable): rides and car hire only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}
async function requireFinance(userId: string) {
  const { requireRole, FINANCE } = await import("./authz.server");
  await requireRole(userId, FINANCE);
}

const COHORTS = ["first_ride", "new_7d", "active_30d", "inactive_60d", "all_customers", "selected"] as const;
type Cohort = (typeof COHORTS)[number];

async function resolveCohort(cohort: Cohort, selected: string[]): Promise<string[]> {
  if (cohort === "selected") return [...new Set(selected)];
  const db = await admin();
  if (cohort === "new_7d" || cohort === "all_customers") {
    let q = db.from("profiles").select("id").limit(5000);
    if (cohort === "new_7d") q = q.gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
    const { data } = await q;
    const { data: staff } = await db.from("user_roles").select("user_id").in("role", ["driver", "fleet_owner", "ops_admin", "finance_admin", "super_admin"]);
    const exclude = new Set((staff ?? []).map((r) => r.user_id));
    return (data ?? []).map((r) => r.id).filter((id) => !exclude.has(id));
  }
  const { data: rides } = await db.from("rides").select("customer_id, completed_at").eq("status", "trip_completed").limit(20000);
  const by = new Map<string, { n: number; last: number }>();
  for (const r of rides ?? []) {
    const t = r.completed_at ? new Date(r.completed_at).getTime() : 0;
    const cur = by.get(r.customer_id) ?? { n: 0, last: 0 };
    by.set(r.customer_id, { n: cur.n + 1, last: Math.max(cur.last, t) });
  }
  const now = Date.now();
  return [...by.entries()]
    .filter(([, v]) =>
      cohort === "first_ride" ? v.n === 1 : cohort === "active_30d" ? v.last >= now - 30 * 86400000 : v.last < now - 60 * 86400000,
    )
    .map(([id]) => id);
}

export const previewFundingCohort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ cohort: z.enum(COHORTS), selected: z.array(z.string().uuid()).max(5000).default([]) }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFinance(context.userId);
    const ids = await resolveCohort(data.cohort, data.selected);
    const db = await admin();
    const { data: sample } = await db.from("profiles").select("id, full_name, phone").in("id", ids.slice(0, 20));
    return { count: ids.length, sample: sample ?? [] };
  });

export const searchWalletCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ q: z.string().min(2).max(60) }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFinance(context.userId);
    const db = await admin();
    const term = data.q.replace(/[%,()]/g, "");
    const { data: rows } = await db.from("profiles").select("id, full_name, phone").or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`).limit(20);
    return rows ?? [];
  });

export const createFundingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ cohort: z.enum(COHORTS), selected: z.array(z.string().uuid()).max(5000).default([]), amountPerUser: z.number().int().positive(), note: z.string().max(200).default("") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requireFinance(context.userId);
    const R = await import("./wallet-rules");
    if (data.amountPerUser > R.FUNDING_MAX_PER_USER) throw new Error(`Max KES ${R.FUNDING_MAX_PER_USER} per account.`);
    const ids = await resolveCohort(data.cohort, data.selected);
    if (ids.length === 0) throw new Error("No accounts match this group.");
    const total = ids.length * data.amountPerUser;
    if (total > R.FUNDING_MAX_BATCH_TOTAL) throw new Error(`Batch total KES ${total.toLocaleString("en-KE")} is above the KES ${R.FUNDING_MAX_BATCH_TOTAL.toLocaleString("en-KE")} limit. Split it.`);
    const { normaliseKenyanPhone } = await import("./phone");
    const approver = normaliseKenyanPhone(R.WALLET_FUNDING_APPROVER_PHONE);
    const db = await admin();
    const { data: batch, error } = await db
      .from("wallet_funding_batches")
      .insert({ created_by: context.userId, cohort: data.cohort, user_ids: ids, amount_per_user: data.amountPerUser, total_amount: total, note: data.note || null, approver_phone: approver })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const { data: intent, error: iErr } = await db
      .from("payment_intents")
      .insert({ customer_id: context.userId, method: "stk_push", amount: R.FUNDING_APPROVAL_AMOUNT, msisdn: approver, status: "pending", idempotency_key: `fundauth:${batch.id}` })
      .select("*")
      .single();
    if (iErr) throw new Error(iErr.message);
    await db.from("wallet_funding_batches").update({ payment_intent_id: intent.id }).eq("id", batch.id);
    const { getPaymentProvider } = await import("./adapters/payment.server");
    const result = await getPaymentProvider().initiateStkPush({ intentId: intent.id, rideReference: "TWENDE-FUND", amount: R.FUNDING_APPROVAL_AMOUNT, msisdn: approver, idempotencyKey: intent.idempotency_key });
    const st = result.status === "blocked_provider_gate" ? "failed" : result.status;
    await db.from("payment_intents").update({ status: st, provider: result.provider, mode: result.mode, provider_reference: result.providerReference, provider_request: result.request as never, provider_response: result.response as never, failure_reason: result.accepted ? null : result.message }).eq("id", intent.id);
    if (!result.accepted) {
      await db.from("wallet_funding_batches").update({ status: "failed" }).eq("id", batch.id);
      throw new Error(result.message);
    }
    const { audit } = await import("./notifications.server");
    await audit(context.userId, "wallet_funding_requested", "wallet_funding_batch", batch.id, { cohort: data.cohort, count: ids.length, total });
    return { batchId: batch.id, count: ids.length, total };
  });

export const approveFundingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ batchId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFinance(context.userId);
    const R = await import("./wallet-rules");
    const db = await admin();
    const { data: batch } = await db.from("wallet_funding_batches").select("*").eq("id", data.batchId).maybeSingle();
    if (!batch) throw new Error("Batch not found.");
    if (batch.status !== "awaiting_code") throw new Error(batch.status === "awaiting_payment" ? "The KES 1 M-PESA approval has not been confirmed yet." : `This batch is ${batch.status}.`);
    if (!batch.code_expires_at || new Date(batch.code_expires_at).getTime() < Date.now()) {
      await db.from("wallet_funding_batches").update({ status: "expired" }).eq("id", batch.id);
      throw new Error("The approval code expired. Start a new batch.");
    }
    if (batch.code_attempts >= R.FUNDING_CODE_MAX_ATTEMPTS) {
      await db.from("wallet_funding_batches").update({ status: "failed" }).eq("id", batch.id);
      throw new Error("Too many wrong codes. Batch locked.");
    }
    const { hashOtp, safeEqual } = await import("./otp.server");
    if (!batch.code_hash || !safeEqual(await hashOtp(data.code, batch.id), batch.code_hash)) {
      await db.from("wallet_funding_batches").update({ code_attempts: batch.code_attempts + 1 }).eq("id", batch.id);
      throw new Error("Wrong approval code.");
    }
    const { data: claimed } = await db
      .from("wallet_funding_batches")
      .update({ status: "approved", approved_by: context.userId, approved_at: new Date().toISOString(), code_hash: null })
      .eq("id", batch.id)
      .eq("status", "awaiting_code")
      .select("id")
      .maybeSingle();
    if (!claimed) throw new Error("This batch was already handled.");
    const { walletMove } = await import("./wallet-gateway.server");
    const { notify, audit } = await import("./notifications.server");
    const amount = Number(batch.amount_per_user);
    for (const uid of batch.user_ids) {
      const res = await walletMove({ userId: uid, amount, kind: "admin_grant", key: `grant:${batch.id}:${uid}`, note: batch.note || "Twende wallet gift", refundable: false, batchId: batch.id });
      if (!res.duplicate) {
        let newBalance: number | null = null;
        try {
          const { data: all } = await db.from("customer_wallet_entries").select("amount, status, refundable").eq("user_id", uid);
          const { walletBalances } = await import("./wallet-rules");
          newBalance = walletBalances(all ?? []).total;
        } catch { /* balance is optional in the message */ }
        const { appLink } = await import("./links.server");
        const body = `Twende added KES ${amount.toLocaleString("en-KE")} credit to your wallet for rides & car hire.${newBalance !== null ? ` New balance KES ${newBalance.toLocaleString("en-KE")}.` : ""} ${appLink("/account")}`;
        // In-app + push + SMS (critical).
        await notify({ userId: uid, templateCode: "wallet_grant", title: "Twende added credit to your wallet", body, critical: true, dedupeKey: `wallet-grant:${batch.id}:${uid}` });
        // WhatsApp, best effort.
        try {
          const { whatsappGatewayConfigured, whatsappGatewaySend } = await import("./whatsapp-gateway.server");
          const { data: p } = await db.from("profiles").select("phone").eq("id", uid).maybeSingle();
          if (whatsappGatewayConfigured() && p?.phone) {
            await whatsappGatewaySend({ to: p.phone.replace(/^\+/, ""), type: "text", text: { body } });
          }
        } catch (e) {
          console.error("wallet grant WhatsApp failed", e);
        }
      }
    }
    await audit(context.userId, "wallet_funding_approved", "wallet_funding_batch", batch.id, { count: batch.user_ids.length, total: batch.total_amount, receipt: batch.mpesa_receipt });
    return { credited: batch.user_ids.length };
  });

export const listFundingBatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireFinance(context.userId);
    const db = await admin();
    const { data } = await db
      .from("wallet_funding_batches")
      .select("id, cohort, amount_per_user, total_amount, note, status, mpesa_receipt, code_expires_at, created_at, approved_at, user_ids")
      .order("created_at", { ascending: false })
      .limit(30);
    return (data ?? []).map(({ user_ids, ...r }) => ({ ...r, count: user_ids.length }));
  });

export const getWalletPromo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireFinance(context.userId);
    const { walletPromoConfig } = await import("./wallet-gateway.server");
    return walletPromoConfig();
  });

export const setWalletPromo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ percent: z.number().min(0).max(50), minTopup: z.number().min(0), cap: z.number().min(0).max(5000) }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFinance(context.userId);
    const db = await admin();
    const rows = [
      { key: "wallet_topup_bonus_percent", value: data.percent },
      { key: "wallet_topup_bonus_min", value: data.minTopup },
      { key: "wallet_topup_bonus_cap", value: data.cap },
    ];
    for (const r of rows) {
      const { error } = await db.from("system_settings").upsert({ key: r.key, value: r.value as never, updated_by: context.userId } as never, { onConflict: "key" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

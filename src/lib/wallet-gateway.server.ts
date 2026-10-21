/**
 * Confirmed M-PESA payments that belong to the customer wallet:
 *  - "wtopup:"   customer top-up → refundable cash (+ optional non-refundable bonus)
 *  - "fundauth:" KES 1 approval for an admin funding batch → SMS approval code to the approver phone
 * Money only lands after the gateway's verified callback (or reconciliation). Idempotent.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FUNDING_APPROVAL_AMOUNT,
  FUNDING_CODE_TTL_MINUTES,
  topupBonus,
} from "./wallet-rules";

interface IntentRow {
  id: string;
  customer_id: string;
  amount: number | string;
  idempotency_key: string;
}

export function isWalletIntent(key: string) {
  return key.startsWith("wtopup:") || key.startsWith("fundauth:");
}

export async function walletMove(args: {
  userId: string;
  amount: number;
  kind: string;
  key: string;
  note: string;
  status?: string;
  rideId?: string | null;
  hireQuoteId?: string | null;
  batchId?: string | null;
  phone?: string | null;
  refundable?: boolean;
}) {
  const { data, error } = await supabaseAdmin.rpc("customer_wallet_move", {
    p_user_id: args.userId,
    p_amount: args.amount,
    p_kind: args.kind,
    p_status: args.status ?? "posted",
    p_ride_id: (args.rideId ?? null) as string,
    p_note: args.note,
    p_key: args.key,
    p_phone: (args.phone ?? null) as string,
    p_refundable: args.refundable ?? true,
    p_hire_quote_id: (args.hireQuoteId ?? null) as string,
    p_batch_id: (args.batchId ?? null) as string,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; duplicate: boolean };
}

async function settingNum(key: string, fallback: number) {
  const { data } = await supabaseAdmin.from("system_settings").select("value").eq("key", key).maybeSingle();
  const n = Number((data?.value as unknown) ?? NaN);
  return Number.isFinite(n) ? n : fallback;
}

export async function walletPromoConfig() {
  return {
    percent: await settingNum("wallet_topup_bonus_percent", 0),
    minTopup: await settingNum("wallet_topup_bonus_min", 500),
    cap: await settingNum("wallet_topup_bonus_cap", 500),
  };
}

export async function handleWalletIntentPaid(intent: IntentRow, receipt: string | null, paidAmount: number | null) {
  if (intent.idempotency_key.startsWith("wtopup:")) {
    const amount = Number(intent.amount);
    const res = await walletMove({
      userId: intent.customer_id,
      amount,
      kind: "wallet_topup",
      key: `topup:${intent.id}`,
      note: `M-PESA top-up${receipt ? ` ${receipt}` : ""}`,
      refundable: true,
    });
    if (res.duplicate) return;
    const bonus = topupBonus(amount, await walletPromoConfig());
    if (bonus > 0) {
      await walletMove({ userId: intent.customer_id, amount: bonus, kind: "topup_bonus", key: `bonus:${intent.id}`, note: "Wallet top-up bonus (rides & car hire only)", refundable: false });
    }
    const { notify } = await import("./notifications.server");
    await notify({
      userId: intent.customer_id,
      templateCode: "wallet_topup",
      title: "Wallet topped up",
      body: `KES ${amount.toLocaleString("en-KE")} added to your Twende wallet${receipt ? ` (M-PESA ${receipt})` : ""}.${bonus > 0 ? ` Bonus KES ${bonus} for rides & car hire.` : ""}`,
      dedupeKey: `wallet-topup:${intent.id}`,
    });
    return;
  }

  if (intent.idempotency_key.startsWith("fundauth:")) {
    const { data: batch } = await supabaseAdmin
      .from("wallet_funding_batches")
      .select("*")
      .eq("payment_intent_id", intent.id)
      .maybeSingle();
    if (!batch || batch.status !== "awaiting_payment") return;
    if (paidAmount !== null && paidAmount < FUNDING_APPROVAL_AMOUNT) return;
    const { randomOtp, hashOtp } = await import("./otp.server");
    const code = randomOtp();
    const { data: claimed } = await supabaseAdmin
      .from("wallet_funding_batches")
      .update({
        status: "awaiting_code",
        mpesa_receipt: receipt ?? `intent:${intent.id}`,
        code_hash: await hashOtp(code, batch.id),
        code_expires_at: new Date(Date.now() + FUNDING_CODE_TTL_MINUTES * 60000).toISOString(),
        code_attempts: 0,
      })
      .eq("id", batch.id)
      .eq("status", "awaiting_payment")
      .select("id")
      .maybeSingle();
    if (!claimed) return;
    const { sendTransactionalSms } = await import("./comms.server");
    const { appLink } = await import("./links.server");
    await sendTransactionalSms({
      to: batch.approver_phone,
      message: `Twende wallet funding approval code: ${code}. ${batch.user_ids.length} accounts, KES ${Number(batch.total_amount).toLocaleString("en-KE")} total. Expires in ${FUNDING_CODE_TTL_MINUTES} min. Never share. ${appLink("/admin/finance")}`,
      eventType: "wallet_funding_code",
      idempotencyKey: `fund-code:${batch.id}`,
    });
  }
}

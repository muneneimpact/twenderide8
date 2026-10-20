/**
 * Customer Twende wallet: holds money from paid rides that found no driver.
 * The rider can retry the same trip with it, keep it for later, or ask for an
 * M-PESA refund. Every movement goes through customer_wallet_move (locked, idempotent).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const UNFULFILLED = ["no_driver_found", "expired"];

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function move(args: { userId: string; amount: number; kind: string; status?: string; rideId?: string | null; note: string; key: string; phone?: string | null }) {
  const { walletMove } = await import("./wallet-gateway.server");
  return walletMove(args);
}

/** Moves a paid, unfulfilled ride's fare into the wallet exactly once. */
async function creditRide(userId: string, rideId: string) {
  const db = await admin();
  const { data: ride } = await db
    .from("rides")
    .select("id, reference, customer_id, status, payment_status, total_fare")
    .eq("id", rideId)
    .maybeSingle();
  if (!ride || ride.customer_id !== userId) throw new Error("Ride not found.");
  if (!UNFULFILLED.includes(ride.status)) throw new Error("Only rides that found no driver can be credited.");
  if (ride.payment_status !== "paid") throw new Error("This ride has no confirmed payment, or a refund is already in progress.");
  await move({ userId, amount: Number(ride.total_fare), kind: "ride_credit", rideId: ride.id, note: `No driver for ride ${ride.reference}`, key: `credit:${ride.id}` });
  return ride;
}

async function balancesFor(userId: string) {
  const db = await admin();
  const { walletBalances } = await import("./wallet-rules");
  const { data } = await db.from("customer_wallet_entries").select("amount, status, refundable").eq("user_id", userId);
  return walletBalances(data ?? []);
}

export const getCustomerWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { data } = await db
      .from("customer_wallet_entries")
      .select("id, amount, kind, status, note, ride_id, hire_quote_id, refundable, payout_reference, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    const rows = (data ?? []).filter((r) => Number(r.amount) !== 0);
    const b = await balancesFor(context.userId);
    const { walletPromoConfig } = await import("./wallet-gateway.server");
    const { data: profile } = await db.from("profiles").select("phone").eq("id", context.userId).maybeSingle();
    return { balance: b.total, refundable: b.cash, promo: b.promo, entries: rows, promoConfig: await walletPromoConfig(), phone: profile?.phone ?? null };
  });

/** Was this ride's payment already moved to the wallet? */
export const getRideCreditState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ rideId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: row } = await db
      .from("customer_wallet_entries")
      .select("id")
      .eq("idempotency_key", `credit:${data.rideId}`)
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: retry } = await db.from("rides").select("id").eq("idempotency_key", `retry:${data.rideId}`).maybeSingle();
    return { credited: Boolean(row), retryRideId: retry?.id ?? null };
  });

export const keepRideAsCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ rideId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await creditRide(context.userId, data.rideId);
    return { ok: true };
  });

/** Same trip, same amount: the paid fare pays for a fresh request. No new M-PESA prompt. */
export const retryRideWithCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ rideId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { loadSettings, settingNumber } = await import("./pricing.server");
    const { dispatchRide } = await import("./dispatch.server");
    const { notify, audit } = await import("./notifications.server");

    const { data: existing } = await db.from("rides").select("*").eq("idempotency_key", `retry:${data.rideId}`).maybeSingle();
    if (existing) return { rideId: existing.id, offers: null as number | null };

    // Credit first (idempotent), so a failed retry never loses the money.
    await creditRide(context.userId, data.rideId);
    const { data: old } = await db.from("rides").select("*").eq("id", data.rideId).single();
    if (!old) throw new Error("Ride not found.");
    const { data: quote } = await db.from("route_quotes").select("pickup_lat, pickup_lng, vehicle_class").eq("id", old.quote_id!).maybeSingle();
    if (!quote) throw new Error("Original trip details are missing. Please book again.");

    const { data: ride, error } = await db
      .from("rides")
      .insert({
        customer_id: context.userId,
        quote_id: old.quote_id,
        trip_kind: old.trip_kind,
        fleet_id: old.trip_kind === "delivery" ? old.fleet_id : null,
        status: "searching",
        payment_method: "stk_push",
        payment_status: "paid",
        idempotency_key: `retry:${old.id}`,
        fare_snapshot: { ...(old.fare_snapshot as object), paid_from_wallet: true, retry_of: old.id } as never,
        total_fare: old.total_fare,
        commission_percent: old.commission_percent,
        commission_amount: old.commission_amount,
        cancellation_policy_snapshot: old.cancellation_policy_snapshot,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    try {
      await move({ userId: context.userId, amount: -Number(ride.total_fare), kind: "ride_payment", rideId: ride.id, note: `Paid ride ${ride.reference} from wallet`, key: `use:${ride.id}` });
    } catch (e) {
      await db.from("rides").update({ status: "cancelled_by_system", payment_status: "not_required" }).eq("id", ride.id);
      throw e;
    }
    await db.from("ride_status_events").insert({ ride_id: ride.id, status: "searching", actor_id: context.userId, actor_role: "customer", note: "Retry paid from Twende wallet" });

    const settings = await loadSettings();
    const dispatch = await dispatchRide(
      ride.id,
      { lat: Number(quote.pickup_lat), lng: Number(quote.pickup_lng) },
      quote.vehicle_class,
      { radiusKm: settingNumber(settings, "dispatch_radius_km", 8), offerTimeoutSeconds: settingNumber(settings, "offer_timeout_seconds", 25), cashRide: false },
    );
    if (dispatch.offers === 0) {
      await db.from("rides").update({ status: "no_driver_found" }).eq("id", ride.id);
      await db.from("ride_status_events").insert({ ride_id: ride.id, status: "no_driver_found", actor_role: "system" });
      await notify({ userId: context.userId, templateCode: "no_driver", title: "Still no driver", body: "No driver nearby yet. Your money is safe — retry or request a refund.", rideId: ride.id, critical: true });
    }
    await audit(context.userId, "ride_retry_with_credit", "ride", ride.id, { retry_of: old.id, offers: dispatch.offers });
    return { rideId: ride.id, offers: dispatch.offers };
  });

/** Sends the whole wallet balance back to M-PESA (finance pays it out). */
export const requestWalletRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ phone: z.string().min(9).max(20) }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { normaliseKenyanPhone } = await import("./phone");
    const phone = normaliseKenyanPhone(data.phone);
    const { data: rows } = await db.from("customer_wallet_entries").select("amount, status, kind").eq("user_id", context.userId);
    if ((rows ?? []).some((r) => r.kind === "refund_payout" && r.status === "pending")) throw new Error("You already have a refund on the way.");
    const balance = (rows ?? []).filter((r) => r.status !== "rejected").reduce((s, r) => s + Number(r.amount), 0);
    if (balance <= 0) throw new Error("Your wallet is empty.");
    await move({ userId: context.userId, amount: -balance, kind: "refund_payout", status: "pending", note: "Refund to M-PESA", key: `payout:${context.userId}:${Date.now()}`, phone });
    return { amount: balance };
  });

export const listWalletPayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, FINANCE } = await import("./authz.server");
    await requireRole(context.userId, FINANCE);
    const db = await admin();
    const { data } = await db
      .from("customer_wallet_entries")
      .select("id, user_id, amount, status, payout_phone, payout_reference, created_at")
      .eq("kind", "refund_payout")
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

export const reviewWalletPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid(), decision: z.enum(["paid", "rejected"]), reference: z.string().max(60).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { requireRole, FINANCE } = await import("./authz.server");
    await requireRole(context.userId, FINANCE);
    if (data.decision === "paid" && !data.reference?.trim()) throw new Error("Enter the M-PESA code you paid with.");
    const db = await admin();
    const { data: row, error } = await db
      .from("customer_wallet_entries")
      .update({ status: data.decision, payout_reference: data.reference?.trim() || null, reviewed_by: context.userId })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("user_id, amount")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This refund was already handled.");
    const { notify } = await import("./notifications.server");
    await notify({
      userId: row.user_id,
      templateCode: "wallet_refund",
      title: data.decision === "paid" ? "Refund sent" : "Refund returned to wallet",
      body: data.decision === "paid"
        ? `Twende sent KES ${Math.abs(Number(row.amount)).toLocaleString("en-KE")} to your M-PESA. Code ${data.reference}.`
        : `Your refund request was declined; KES ${Math.abs(Number(row.amount)).toLocaleString("en-KE")} is back in your Twende wallet.`,
    });
    return { ok: true };
  });

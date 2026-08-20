/** Server-only wallet ledger posting. Every entry is idempotent and immutable. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type EntryType = Database["public"]["Enums"]["ledger_entry_type"];

export interface LedgerEntryInput {
  walletId: string;
  entryType: EntryType;
  amount: number;
  idempotencyKey: string;
  rideId?: string | null;
  paymentIntentId?: string | null;
  withdrawalId?: string | null;
  actorId?: string | null;
  source?: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export async function postLedgerEntry(input: LedgerEntryInput) {
  const { data, error } = await supabaseAdmin
    .from("wallet_ledger")
    .insert({
      wallet_id: input.walletId,
      entry_type: input.entryType,
      amount: input.amount,
      ride_id: input.rideId ?? null,
      payment_intent_id: input.paymentIntentId ?? null,
      withdrawal_id: input.withdrawalId ?? null,
      idempotency_key: input.idempotencyKey,
      actor_id: input.actorId ?? null,
      source: input.source ?? "system",
      reason: input.reason ?? null,
      metadata: (input.metadata ?? {}) as never,
    })
    .select()
    .maybeSingle();

  if (error) {
    // Duplicate idempotency key means the entry already exists: never post twice.
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      const { data: existing } = await supabaseAdmin
        .from("wallet_ledger")
        .select()
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      return { entry: existing, duplicate: true as const };
    }
    throw new Error(`Ledger posting failed: ${error.message}`);
  }
  return { entry: data, duplicate: false as const };
}

export async function ensureDriverWallet(driverId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("wallets")
    .select("id")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await supabaseAdmin
    .from("wallets")
    .insert({ owner_kind: "driver", driver_id: driverId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

export async function ensureFleetWallet(fleetId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("wallets")
    .select("id")
    .eq("fleet_id", fleetId)
    .maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await supabaseAdmin
    .from("wallets")
    .insert({ owner_kind: "fleet", fleet_id: fleetId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

export async function ensurePlatformWallet(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("wallets")
    .select("id")
    .eq("owner_kind", "platform")
    .maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await supabaseAdmin
    .from("wallets")
    .insert({ owner_kind: "platform" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

export interface SettlementSnapshot {
  mode: "driver_wallet" | "fleet_wallet" | "split";
  driver_split_percent: number;
  cash_commission_liability: "driver" | "fleet";
  fleet_id: string | null;
  decided_at: string;
}

export async function resolveSettlement(
  driverId: string,
  fleetId: string | null,
  allowedModes: string[],
): Promise<SettlementSnapshot> {
  if (!fleetId) {
    return {
      mode: "driver_wallet",
      driver_split_percent: 100,
      cash_commission_liability: "driver",
      fleet_id: null,
      decided_at: new Date().toISOString(),
    };
  }
  const { data: fleet } = await supabaseAdmin
    .from("fleets")
    .select("settlement_mode, driver_split_percent, cash_commission_liability")
    .eq("id", fleetId)
    .maybeSingle();

  const requested = (fleet?.settlement_mode ?? "fleet_wallet") as SettlementSnapshot["mode"];
  const mode = allowedModes.includes(requested) ? requested : "fleet_wallet";
  return {
    mode,
    driver_split_percent: mode === "split" ? Number(fleet?.driver_split_percent ?? 0) : mode === "driver_wallet" ? 100 : 0,
    cash_commission_liability:
      (fleet?.cash_commission_liability ?? "driver") as SettlementSnapshot["cash_commission_liability"],
    fleet_id: fleetId,
    decided_at: new Date().toISOString(),
  };
}

/**
 * Posts earnings and commission for a completed ride exactly once.
 * Digital rides credit net earnings; cash rides debit the commission because the
 * driver already collected the money from the customer.
 */
export async function settleRide(rideId: string) {
  const { data: ride, error } = await supabaseAdmin
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();
  if (error || !ride) throw new Error("Ride not found for settlement");
  if (ride.ledger_posted_at) return { posted: false, reason: "already_settled" as const };
  if (ride.status !== "trip_completed") return { posted: false, reason: "not_completed" as const };
  if (!ride.driver_id) return { posted: false, reason: "no_driver" as const };

  const settlement = ride.settlement_snapshot as unknown as SettlementSnapshot;
  const commission = Number(ride.commission_amount);
  const gross = Number(ride.total_fare);
  const net = Number((gross - commission).toFixed(2));
  const platformWallet = await ensurePlatformWallet();
  const driverWallet = await ensureDriverWallet(ride.driver_id);
  const fleetWallet = settlement?.fleet_id ? await ensureFleetWallet(settlement.fleet_id) : null;

  if (ride.payment_method === "stk_push") {
    if (ride.payment_status !== "paid") return { posted: false, reason: "payment_not_verified" as const };

    const shares: { walletId: string; amount: number; label: string }[] = [];
    if (settlement?.mode === "fleet_wallet" && fleetWallet) {
      shares.push({ walletId: fleetWallet, amount: net, label: "fleet" });
    } else if (settlement?.mode === "split" && fleetWallet) {
      const driverShare = Number(((net * (settlement.driver_split_percent ?? 0)) / 100).toFixed(2));
      shares.push({ walletId: driverWallet, amount: driverShare, label: "driver" });
      shares.push({ walletId: fleetWallet, amount: Number((net - driverShare).toFixed(2)), label: "fleet" });
    } else {
      shares.push({ walletId: driverWallet, amount: net, label: "driver" });
    }

    for (const share of shares) {
      await postLedgerEntry({
        walletId: share.walletId,
        entryType: "ride_earning",
        amount: share.amount,
        rideId: ride.id,
        idempotencyKey: `ride_earning:${ride.id}:${share.label}`,
        reason: `Net earnings for ride ${ride.reference}`,
        metadata: { gross, commission, settlement },
      });
    }
    await postLedgerEntry({
      walletId: platformWallet,
      entryType: "platform_commission",
      amount: commission,
      rideId: ride.id,
      idempotencyKey: `platform_commission:${ride.id}`,
      reason: `Commission for ride ${ride.reference}`,
    });
  } else {
    // Cash: the driver holds the customer's money, so the commission is owed.
    const liableWallet =
      settlement?.cash_commission_liability === "fleet" && fleetWallet ? fleetWallet : driverWallet;
    await postLedgerEntry({
      walletId: liableWallet,
      entryType: "cash_commission_debit",
      amount: -commission,
      rideId: ride.id,
      idempotencyKey: `cash_commission:${ride.id}`,
      reason: `Platform charge owed on cash ride ${ride.reference}`,
      metadata: { gross, commission, settlement },
    });
    await postLedgerEntry({
      walletId: platformWallet,
      entryType: "platform_commission",
      amount: commission,
      rideId: ride.id,
      idempotencyKey: `platform_commission:${ride.id}`,
      reason: `Cash commission for ride ${ride.reference}`,
    });
  }

  await supabaseAdmin
    .from("rides")
    .update({ ledger_posted_at: new Date().toISOString() })
    .eq("id", ride.id)
    .is("ledger_posted_at", null);

  await enforceOverdraftPolicy(ride.driver_id);
  return { posted: true, reason: "settled" as const };
}

/** Applies the configured overdraft thresholds after a debit. */
export async function enforceOverdraftPolicy(driverId: string) {
  const { data: settings } = await supabaseAdmin
    .from("system_settings")
    .select("key, value")
    .in("key", ["wallet_overdraft_limit", "wallet_overdraft_warning"]);
  const map = new Map((settings ?? []).map((row) => [row.key, Number(row.value)]));
  const limit = map.get("wallet_overdraft_limit") ?? -2000;
  const warning = map.get("wallet_overdraft_warning") ?? -500;

  const { data: wallet } = await supabaseAdmin
    .from("wallets")
    .select("cached_balance")
    .eq("driver_id", driverId)
    .maybeSingle();
  const balance = Number(wallet?.cached_balance ?? 0);

  const blocked = balance <= limit;
  await supabaseAdmin.from("drivers").update({ cash_jobs_blocked: blocked }).eq("id", driverId);
  return { balance, warning: balance <= warning && !blocked, blocked, limit, warning_threshold: warning };
}

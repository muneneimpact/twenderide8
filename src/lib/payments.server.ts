/**
 * Twende Payments result processing (server-only).
 *
 * One code path handles both gateway callbacks and reconciliation reads, so a
 * payment can never be "confirmed" two different ways. Every step is
 * idempotent: replaying the same transaction changes nothing.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TwendeTransaction } from "./adapters/palpluss.server";
import type { Database } from "@/integrations/supabase/types";

type PaymentStatus = Database["public"]["Enums"]["payment_status"];

export interface ApplyResult {
  matched: boolean;
  status: PaymentStatus | "ignored";
  rideId?: string;
  detail: string;
}

/** Maps the gateway's terminal states onto our own payment states. */
function mapStatus(status: string): PaymentStatus | null {
  switch (status.toUpperCase()) {
    case "SUCCESS":
    case "COMPLETED":
      return "paid";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
    case "TIMEOUT":
      return "timed_out";
    case "PENDING":
    case "PROCESSING":
      return null;
    default:
      return null;
  }
}

/** Stores the raw gateway payload before anything is acted on. */
export async function recordGatewayEvent(input: {
  transactionId: string;
  eventType: string;
  status: string;
  payload: unknown;
  verified: boolean;
  paymentIntentId?: string | null;
}) {
  await supabaseAdmin.from("payment_events").insert({
    payment_intent_id: input.paymentIntentId ?? null,
    provider: "twende_payments",
    event_type: input.eventType,
    provider_reference: input.transactionId,
    dedupe_key: `twende:${input.transactionId}:${input.status.toUpperCase()}`,
    verified: input.verified,
    payload: input.payload as never,
  });
}

async function findIntent(tx: TwendeTransaction) {
  const { data: byReference } = await supabaseAdmin
    .from("payment_intents")
    .select("*")
    .eq("provider_reference", tx.id)
    .maybeSingle();
  if (byReference) return byReference;

  if (tx.externalReference) {
    const { data: hireQuote } = await supabaseAdmin
      .from("hire_quotes")
      .select("id")
      .eq("reference", tx.externalReference)
      .maybeSingle();
    if (hireQuote) {
      const { data: hireIntents } = await supabaseAdmin
        .from("payment_intents")
        .select("*")
        .eq("hire_quote_id", hireQuote.id)
        .order("created_at", { ascending: false })
        .limit(2);
      // A reference-only match is safe only before retries exist. Once there are
      // multiple attempts, require the gateway's provider transaction ID.
      if (hireIntents?.length === 1) return hireIntents[0];
      if (hireIntents && hireIntents.length > 1) return null;
    }
    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id")
      .eq("reference", tx.externalReference)
      .maybeSingle();
    if (ride) {
      const { data: latest } = await supabaseAdmin
        .from("payment_intents")
        .select("*")
        .eq("ride_id", ride.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) return latest;
    }
  }
  return null;
}

/**
 * Applies a gateway transaction to our records and runs the business actions a
 * successful payment must trigger — settlement, receipt and notifications.
 */
export async function applyGatewayTransaction(tx: TwendeTransaction): Promise<ApplyResult> {
  const status = mapStatus(tx.status);
  if (!status) return { matched: false, status: "ignored", detail: "Transaction still in flight." };

  const intent = await findIntent(tx);
  if (!intent) {
    const dues = await applyPlatformDues(tx, status);
    if (dues) return dues;
    return { matched: false, status: "ignored", detail: "No matching payment on file." };
  }

  if (intent.status === "paid") {
    if (intent.hire_quote_id) {
      const { settleHirePayment } = await import("./hire-payments.server");
      await settleHirePayment(intent.id, tx.mpesaReceipt ?? null);
    } else if (!intent.ride_id) {
      const { isWalletIntent, handleWalletIntentPaid } = await import("./wallet-gateway.server");
      if (isWalletIntent(intent.idempotency_key)) await handleWalletIntentPaid(intent, tx.mpesaReceipt ?? null, tx.amount != null ? Number(tx.amount) : null);
    }
    return {
      matched: true,
      status: "paid",
      ...(intent.ride_id ? { rideId: intent.ride_id } : {}),
      detail: "Already confirmed; ignoring a later non-paid status.",
    };
  }

  const { data: appliedIntent, error: applyError } = await supabaseAdmin
    .from("payment_intents")
    .update({
      status,
      provider: "twende_payments",
      provider_reference: tx.id,
      provider_response: {
        ...(tx.raw as Record<string, unknown>),
        mpesa_receipt: tx.mpesaReceipt,
        result_code: tx.resultCode,
        result_desc: tx.resultDesc,
      } as never,
      failure_reason: status === "paid" ? null : (tx.resultDesc ?? "Payment was not completed."),
    })
    .eq("id", intent.id)
    .neq("status", "paid")
    .select("id")
    .maybeSingle();
  if (applyError) throw new Error(`Could not update payment status: ${applyError.message}`);

  if (!appliedIntent) {
    const { data: current } = await supabaseAdmin
      .from("payment_intents")
      .select("status")
      .eq("id", intent.id)
      .maybeSingle();
    if (current?.status === "paid") {
      if (intent.hire_quote_id) {
        const { settleHirePayment } = await import("./hire-payments.server");
        await settleHirePayment(intent.id, tx.mpesaReceipt ?? null);
      } else if (intent.ride_id) {
        await onPaymentConfirmed(intent.ride_id, tx);
      }
      return {
        matched: true,
        status: "paid",
        ...(intent.ride_id ? { rideId: intent.ride_id } : {}),
        detail: "Already confirmed; ignored a later status.",
      };
    }
  }

  if (intent.hire_quote_id) {
    if (status === "paid") {
      const { settleHirePayment } = await import("./hire-payments.server");
      await settleHirePayment(intent.id, tx.mpesaReceipt ?? null);
    } else if (status === "failed" || status === "cancelled" || status === "timed_out") {
      const { markHirePaymentFailure } = await import("./hire-payments.server");
      await markHirePaymentFailure(intent.id, status);
    }
    return {
      matched: true,
      status,
      detail:
        status === "paid" ? "Hire payment confirmed." : (tx.resultDesc ?? "Hire payment failed."),
    };
  }

  if (!intent.ride_id) {
    const { isWalletIntent, handleWalletIntentPaid } = await import("./wallet-gateway.server");
    if (status === "paid" && isWalletIntent(intent.idempotency_key)) {
      await handleWalletIntentPaid(intent, tx.mpesaReceipt ?? null, tx.amount != null ? Number(tx.amount) : null);
    } else if (intent.idempotency_key.startsWith("fundauth:") && status !== "paid") {
      await supabaseAdmin.from("wallet_funding_batches").update({ status: "failed" }).eq("payment_intent_id", intent.id).eq("status", "awaiting_payment");
    }
    return {
      matched: true,
      status,
      detail: status === "paid" ? "Payment confirmed." : (tx.resultDesc ?? "Payment failed."),
    };
  }
  await supabaseAdmin.from("rides").update({ payment_status: status }).eq("id", intent.ride_id);

  if (status !== "paid") {
    return {
      matched: true,
      status,
      rideId: intent.ride_id,
      detail: tx.resultDesc ?? "Payment failed.",
    };
  }

  await onPaymentConfirmed(intent.ride_id, tx);
  return { matched: true, status, rideId: intent.ride_id, detail: "Payment confirmed." };
}

/** Business actions that must run exactly once per confirmed ride payment. */
async function onPaymentConfirmed(rideId: string, tx: TwendeTransaction) {
  const { settleRide } = await import("./ledger.server");
  const { notify, emailTemplate, audit } = await import("./notifications.server");
  const { checkTripMilestone } = await import("./milestones.server");

  const { data: ride } = await supabaseAdmin
    .from("rides")
    .select("id, reference, customer_id, total_fare, status, quote_id")
    .eq("id", rideId)
    .maybeSingle();
  if (!ride) return;

  if (ride.status === "trip_completed") {
    try {
      await settleRide(ride.id);
    } catch (error) {
      console.error("settlement after payment failed", error);
    }
    try {
      await checkTripMilestone(ride.customer_id);
    } catch (error) {
      console.error("milestone check failed", error);
    }
  }

  const receipt = tx.mpesaReceipt ?? "confirmed";
  await notify({
    userId: ride.customer_id,
    templateCode: "payment_confirmed",
    title: "Payment received",
    body: `Twende Payments received KES ${Number(ride.total_fare).toFixed(2)} for ride ${ride.reference}. M-Pesa receipt ${receipt}.`,
    rideId: ride.id,
    critical: true,
    dedupeKey: `payment-confirmed:${ride.id}:${tx.id}`,
  });

  const { data: quote } = await supabaseAdmin
    .from("route_quotes")
    .select("pickup_address, dropoff_address, distance_km")
    .eq("id", ride.quote_id)
    .maybeSingle();
  const { data: customer } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", ride.customer_id)
    .maybeSingle();

  await emailTemplate({
    userId: ride.customer_id,
    template: {
      code: "trip_receipt",
      data: {
        customerName: customer?.full_name ?? "Customer",
        reference: ride.reference,
        when: new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }),
        pickup: quote?.pickup_address ?? "Pickup point",
        dropoff: quote?.dropoff_address ?? "Destination",
        distanceKm: Number(quote?.distance_km ?? 0),
        fare: `KES ${Number(ride.total_fare).toFixed(2)}`,
        paymentMethod: `Twende Payments (M-Pesa ${receipt})`,
      },
    },
    eventType: "payment_receipt",
    idempotencyKey: `payment-receipt:${ride.id}:${tx.id}`,
    rideId: ride.id,
  });

  await audit(null, "payment_confirmed", "ride", ride.id, {
    transaction_id: tx.id,
    mpesa_receipt: tx.mpesaReceipt,
    amount: tx.amount,
  });
}

/**
 * A driver settling the commission they owe on cash trips. The payment has no
 * ride, so it is matched through the audit trail written when it was started.
 */
async function applyPlatformDues(
  tx: TwendeTransaction,
  status: PaymentStatus,
): Promise<ApplyResult | null> {
  const { data: log } = await supabaseAdmin
    .from("audit_logs")
    .select("id, actor_id, entity_id, metadata")
    .eq("action", "driver.pay_platform_dues")
    .contains("metadata", { provider_reference: tx.id })
    .maybeSingle();
  if (!log?.entity_id) return null;

  if (status !== "paid") {
    return { matched: true, status, detail: tx.resultDesc ?? "Dues payment failed." };
  }

  const { postLedgerEntry } = await import("./ledger.server");
  await postLedgerEntry({
    walletId: log.entity_id,
    entryType: "top_up",
    amount: Number(tx.amount),
    idempotencyKey: `dues_settlement:${tx.id}`,
    actorId: log.actor_id,
    source: "twende_payments",
    reason: "Cash commission settlement",
    metadata: { transaction_id: tx.id, mpesa_receipt: tx.mpesaReceipt },
  });

  if (log.actor_id) {
    const { notify } = await import("./notifications.server");
    await notify({
      userId: log.actor_id,
      templateCode: "dues_settled",
      title: "Payment received",
      body: `Twende Payments received KES ${Number(tx.amount).toFixed(2)} towards what you owe the platform. Receipt ${tx.mpesaReceipt ?? "confirmed"}.`,
      dedupeKey: `dues-settled:${tx.id}`,
    });
  }

  return { matched: true, status, detail: "Dues settled." };
}

/**
 * Safety net for callbacks that never arrive: reads the gateway's own record
 * for payments still waiting and applies whatever it says.
 */
export async function reconcilePendingPayments(limit = 25) {
  const { getTransaction, gatewayConfigured } = await import("./adapters/palpluss.server");
  if (!gatewayConfigured()) return { checked: 0, updated: 0 };

  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const { data: pending } = await supabaseAdmin
    .from("payment_intents")
    .select("id, provider_reference, created_at")
    .in("status", ["pending", "initiating", "awaiting_confirmation", "processing"])
    .not("provider_reference", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);

  const { data: ambiguousTimeouts } = await supabaseAdmin
    .from("payment_intents")
    .select("id, provider_reference, created_at")
    .eq("status", "timed_out")
    .eq(
      "failure_reason",
      "No confirmation was received in time; gateway status is still being checked.",
    )
    .not("provider_reference", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  const intentsToCheck = [...(pending ?? []), ...(ambiguousTimeouts ?? [])];
  let updated = 0;
  for (const intent of intentsToCheck) {
    if (!intent.provider_reference) continue;
    const tx = await getTransaction(intent.provider_reference);
    if (!tx) continue;
    await recordGatewayEvent({
      transactionId: tx.id,
      eventType: "reconciliation",
      status: tx.status,
      payload: tx.raw,
      verified: true,
      paymentIntentId: intent.id,
    });
    const result = await applyGatewayTransaction(tx);
    if (result.status !== "ignored") updated += 1;
  }

  // Anything still unconfirmed after an hour is timed out so nobody waits forever.
  const stale = new Date(Date.now() - 3600_000).toISOString();
  const { data: timedOut } = await supabaseAdmin
    .from("payment_intents")
    .update({ status: "timed_out", failure_reason: "No confirmation was received in time; gateway status is still being checked." })
    .in("status", ["pending", "initiating", "awaiting_confirmation", "processing"])
    .lt("created_at", stale)
    .select("id, hire_quote_id");
  if (timedOut?.length) {
    const { markHirePaymentFailure } = await import("./hire-payments.server");
    await Promise.all(
      timedOut
        .filter((intent) => intent.hire_quote_id)
        .map((intent) => markHirePaymentFailure(intent.id, "timed_out")),
    );
  }

  return { checked: intentsToCheck.length, updated };
}

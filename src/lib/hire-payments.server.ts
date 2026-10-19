import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPaymentProvider } from "./adapters/payment.server";
import { normaliseKenyanPhone } from "./phone";

type HirePaymentPolicy = "full" | "daily_flexible" | "legacy";
type HirePaymentQuote = {
  id: string;
  reference: string;
  requester_id: string;
  vehicle_id: string | null;
  estimated_total: number;
  quoted_total: number | null;
  payment_policy: string;
  payment_status: string;
  payment_paid_total: number;
  payment_minimum_amount: number | null;
  payment_hold_expires_at: string | null;
  days: number;
  status: string;
  contact_phone: string | null;
  contact_email: string | null;
};

function finalTotal(quote: Pick<HirePaymentQuote, "estimated_total" | "quoted_total">) {
  return Number(quote.quoted_total ?? quote.estimated_total);
}

function firstPaymentMinimum(quote: HirePaymentQuote) {
  return Number(
    quote.payment_minimum_amount ??
      (quote.payment_policy === "daily_flexible"
        ? Math.ceil(finalTotal(quote) / Math.max(1, quote.days))
        : finalTotal(quote)),
  );
}

async function loadQuote(quoteId: string): Promise<HirePaymentQuote> {
  const { data, error } = await supabaseAdmin
    .from("hire_quotes")
    .select(
      "id, reference, requester_id, vehicle_id, estimated_total, quoted_total, payment_policy, payment_status, payment_paid_total, payment_minimum_amount, payment_hold_expires_at, days, status, contact_phone, contact_email",
    )
    .eq("id", quoteId)
    .maybeSingle();
  if (error || !data) throw new Error("Hire booking was not found.");
  return data as HirePaymentQuote;
}

async function commissionPercent(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "hire_commission_percent")
    .maybeSingle();
  const value = Number(data?.value ?? 7);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 7;
}

/** Creates an M-Pesa prompt without ever marking it paid; a verified callback does that. */
export async function startHirePayment(input: {
  quoteId: string;
  actorId: string;
  amount: number;
  phone: string;
}) {
  const quote = await loadQuote(input.quoteId);
  if (input.actorId !== quote.requester_id) {
    if (!quote.vehicle_id) throw new Error("You cannot start payment for this hire request.");
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id, owner_driver_id, fleet_id")
      .eq("id", quote.vehicle_id)
      .maybeSingle();
    if (!vehicle) throw new Error("Hire vehicle no longer exists.");
    const owns = vehicle.owner_driver_id === input.actorId;
    const { data: mayDrive } = await supabaseAdmin.rpc("may_drive_vehicle", {
      _user_id: input.actorId,
      _vehicle_id: vehicle.id,
    });
    let ownsFleet = false;
    if (!owns && vehicle.fleet_id) {
      const { data: fleetOwned } = await supabaseAdmin.rpc("owns_fleet", {
        _user_id: input.actorId,
        _fleet_id: vehicle.fleet_id,
      });
      ownsFleet = Boolean(fleetOwned);
    }
    if (!owns && !ownsFleet && !mayDrive)
      throw new Error("You cannot start payment for this hire vehicle.");
  }
  if (!quote.vehicle_id || quote.payment_policy === "legacy") {
    throw new Error("This booking does not use the listed-car payment flow.");
  }
  if (!["submitted", "confirmed"].includes(quote.status)) {
    throw new Error("This hire request is no longer open for payment.");
  }
  if (quote.payment_status === "paid") throw new Error("This hire booking is already fully paid.");

  const phone = normaliseKenyanPhone(input.phone);
  if (!phone) throw new Error("Enter a valid Kenyan M-Pesa number.");
  if (input.actorId === quote.requester_id && quote.contact_phone !== phone) {
    const { error } = await supabaseAdmin
      .from("hire_quotes")
      .update({ contact_phone: phone })
      .eq("id", quote.id);
    if (error) throw new Error(`Could not save the payment phone: ${error.message}`);
  }
  const total = finalTotal(quote);
  const paid = Number(quote.payment_paid_total ?? 0);
  const remaining = Math.max(0, total - paid);
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("Payment amount must be greater than zero.");
  if (amount > remaining)
    throw new Error("Payment amount cannot exceed the remaining hire balance.");

  const minimum = firstPaymentMinimum(quote);
  if (paid < minimum && amount < minimum - paid) {
    throw new Error(
      quote.payment_policy === "full"
        ? "This vehicle requires full payment before the owner can see the booking."
        : `Pay at least KES ${Math.ceil(minimum - paid).toLocaleString("en-KE")} before the owner can see the booking.`,
    );
  }
  if (quote.payment_policy === "full" && amount < remaining) {
    throw new Error("This vehicle requires the full remaining hire amount in one payment.");
  }

  const { data: ambiguousTimeout } = await supabaseAdmin
    .from("payment_intents")
    .select("id")
    .eq("hire_quote_id", quote.id)
    .eq("status", "timed_out")
    .eq(
      "failure_reason",
      "No confirmation was received in time; gateway status is still being checked.",
    )
    .limit(1)
    .maybeSingle();
  if (ambiguousTimeout) {
    throw new Error(
      "The previous M-Pesa request is still being checked. Please wait for its confirmed status before retrying to avoid a duplicate charge.",
    );
  }

  const { data: openIntent } = await supabaseAdmin
    .from("payment_intents")
    .select("id")
    .eq("hire_quote_id", quote.id)
    .in("status", ["initiating", "pending", "awaiting_confirmation", "processing"])
    .limit(1)
    .maybeSingle();
  if (openIntent)
    throw new Error("A payment prompt is already pending. Complete it or wait for it to expire.");

  const idempotencyKey = `hire:${quote.id}:${randomUUID()}`;
  const { data: intent, error: insertError } = await supabaseAdmin
    .from("payment_intents")
    .insert({
      ride_id: null,
      hire_quote_id: quote.id,
      customer_id: quote.requester_id,
      method: "stk_push",
      amount,
      msisdn: phone,
      idempotency_key: idempotencyKey,
      status: "initiating",
      provider: "twende_payments",
      mode: process.env["PAYMENTS_TEST_MODE"] === "true" ? "test" : "live",
      provider_request: {} as never,
      provider_response: {} as never,
    })
    .select("id")
    .single();
  if (insertError || !intent) {
    if (insertError?.code === "23505") {
      throw new Error("A payment prompt is already pending. Complete it or wait for it to expire.");
    }
    throw new Error(`Could not start the hire payment: ${insertError?.message ?? "unknown error"}`);
  }

  const holdExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  // Start the short availability hold before contacting the gateway.
  if (paid < minimum) {
    const { error } = await supabaseAdmin
      .from("hire_quotes")
      .update({ payment_status: "pending", payment_hold_expires_at: holdExpiresAt })
      .eq("id", quote.id);
    if (error) {
      await supabaseAdmin
        .from("payment_intents")
        .update({ status: "failed", failure_reason: error.message.slice(0, 500) })
        .eq("id", intent.id)
        .eq("status", "initiating");
      throw new Error(`Could not reserve the payment window: ${error.message}`);
    }
  }

  const provider = getPaymentProvider();
  try {
    const result = await provider.initiateStkPush({
      intentId: intent.id,
      rideReference: quote.reference,
      amount,
      msisdn: phone,
      idempotencyKey,
      purpose: "hire",
    });
    const nextStatus = result.accepted ? "awaiting_confirmation" : "failed";
    await supabaseAdmin
      .from("payment_intents")
      .update({
        status: nextStatus,
        provider: result.provider,
        mode: result.mode,
        provider_reference: result.providerReference,
        provider_request: result.request as never,
        provider_response: result.response as never,
        failure_reason: result.accepted ? null : result.message,
      })
      .eq("id", intent.id)
      .eq("status", "initiating");

    const { data: currentIntent } = await supabaseAdmin
      .from("payment_intents")
      .select("status")
      .eq("id", intent.id)
      .maybeSingle();
    if (currentIntent?.status === "paid") {
      return {
        accepted: true,
        status: "paid" as const,
        message: "Payment confirmed.",
        amount,
        intentId: intent.id,
      };
    }

    if (!result.accepted) {
      await supabaseAdmin
        .from("hire_quotes")
        .update({ payment_status: paid > 0 ? "partial" : "failed", payment_hold_expires_at: null })
        .eq("id", quote.id);
    }
    return {
      accepted: result.accepted,
      status: result.accepted ? ("awaiting_confirmation" as const) : ("failed" as const),
      message: result.message,
      amount,
      intentId: intent.id,
      holdExpiresAt: result.accepted && paid < minimum ? holdExpiresAt : null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "M-Pesa could not be reached.";
    await supabaseAdmin
      .from("payment_intents")
      .update({ status: "failed", failure_reason: detail.slice(0, 500) })
      .eq("id", intent.id)
      .eq("status", "initiating");
    const { data: currentIntent } = await supabaseAdmin
      .from("payment_intents")
      .select("status")
      .eq("id", intent.id)
      .maybeSingle();
    if (currentIntent?.status === "paid") {
      return {
        accepted: true,
        status: "paid" as const,
        message: "Payment confirmed.",
        amount,
        intentId: intent.id,
      };
    }
    await supabaseAdmin
      .from("hire_quotes")
      .update({ payment_status: paid > 0 ? "partial" : "failed", payment_hold_expires_at: null })
      .eq("id", quote.id);
    return {
      accepted: false,
      status: "failed" as const,
      message: `M-Pesa payment could not be started: ${detail}`,
      amount,
      intentId: intent.id,
    };
  }
}

/** Verified successful hire payment: atomically records fees, owner balance and booking visibility. */
export async function settleHirePayment(paymentIntentId: string, receipt: string | null) {
  const { data, error } = await supabaseAdmin.rpc("apply_hire_payment", {
    p_payment_intent_id: paymentIntentId,
    ...(receipt ? { p_mpesa_receipt: receipt } : {}),
  });
  if (error) throw new Error(`Hire payment settlement failed: ${error.message}`);
  const result = (data ?? {}) as {
    hire_quote_id?: string;
    owner_user_id?: string;
    gross_amount?: number;
    platform_fee_amount?: number;
    owner_net_amount?: number;
    commission_percent?: number;
    payment_status?: string;
    paid_total?: number;
    payment_threshold?: number;
  };

  const fee = Number(result.platform_fee_amount ?? 0);
  if (fee > 0) {
    const { ensurePlatformWallet, postLedgerEntry } = await import("./ledger.server");
    const walletId = await ensurePlatformWallet();
    await postLedgerEntry({
      walletId,
      entryType: "platform_commission",
      amount: fee,
      paymentIntentId,
      idempotencyKey: `hire_platform_commission:${paymentIntentId}`,
      source: "twende_payments",
      reason: `Hire commission${result.hire_quote_id ? ` for booking ${result.hire_quote_id}` : ""}`,
      metadata: {
        hire_quote_id: result.hire_quote_id ?? null,
        commission_percent: result.commission_percent ?? null,
        gross_amount: result.gross_amount ?? null,
      },
    });
  }

  const { data: quote } = result.hire_quote_id
    ? await supabaseAdmin
        .from("hire_quotes")
        .select(
          "id, reference, requester_id, payment_status, payment_paid_total, estimated_total, quoted_total",
        )
        .eq("id", result.hire_quote_id)
        .maybeSingle()
    : { data: null };
  const { data: intent } = await supabaseAdmin
    .from("payment_intents")
    .select("amount")
    .eq("id", paymentIntentId)
    .maybeSingle();

  if (quote) {
    const { notify, audit } = await import("./notifications.server");
    const paidTotal = Number(result.paid_total ?? quote.payment_paid_total ?? 0);
    const fullTotal = Number(quote.quoted_total ?? quote.estimated_total);
    const receiptText = receipt ? ` Receipt ${receipt}.` : "";
    await notify({
      userId: quote.requester_id,
      templateCode: "hire_payment_received",
      title: "Hire payment received",
      body: `KES ${Number(intent?.amount ?? result.gross_amount ?? 0).toLocaleString("en-KE")} received for hire ${quote.reference}.${receiptText} Paid so far: KES ${paidTotal.toLocaleString("en-KE")} of KES ${fullTotal.toLocaleString("en-KE")}.`,
      critical: true,
      dedupeKey: `hire-payment-received:${paymentIntentId}`,
      payload: {
        hireQuoteId: quote.id,
        paymentStatus: result.payment_status ?? quote.payment_status,
      },
    });
    const paidInFull =
      (result.payment_status ?? quote.payment_status) === "paid" || paidTotal >= fullTotal;
    if (paidInFull) {
      const message = `Twende Meru: hire ${quote.reference} is PAID IN FULL - KES ${paidTotal.toLocaleString("en-KE")}.${receiptText} Download your full receipt with every payment in the app > Hire > Your requests.`;
      await notify({
        userId: quote.requester_id,
        templateCode: "hire_paid_in_full",
        title: "Hire paid in full",
        body: message,
        critical: true,
        dedupeKey: `hire-paid-in-full:${quote.id}`,
        payload: { hireQuoteId: quote.id, paymentStatus: "paid" },
      });
      const { data: renter } = await supabaseAdmin
        .from("profiles")
        .select("phone")
        .eq("id", quote.requester_id)
        .maybeSingle();
      if (renter?.phone) {
        const { sendTransactionalSms } = await import("./comms.server");
        await sendTransactionalSms({
          to: renter.phone,
          message,
          eventType: "hire_paid_in_full_sms",
          idempotencyKey: `hire-paid-in-full-sms:${quote.id}`,
          context: { userId: quote.requester_id, paymentIntentId },
        }).catch((error) => console.error("paid in full sms failed", error));
      }
    }
    if (result.owner_user_id) {
      await notify({
        userId: result.owner_user_id,
        templateCode: "hire_booking_paid",
        title: "Paid hire booking available",
        body: `Booking ${quote.reference} has cleared the required payment. Net owner earnings from this instalment: KES ${Number(result.owner_net_amount ?? 0).toLocaleString("en-KE")}; platform commission: KES ${fee.toLocaleString("en-KE")} (${Number(result.commission_percent ?? 0)}%).`,
        critical: true,
        dedupeKey: `hire-owner-payment:${paymentIntentId}`,
        payload: {
          hireQuoteId: quote.id,
          paymentStatus: result.payment_status ?? quote.payment_status,
        },
      });
    }
    // Instant SMS to the owner/assigned driver so they can prepare the car.
    if (result.owner_user_id) {
      const { data: owner } = await supabaseAdmin
        .from("profiles")
        .select("phone")
        .eq("id", result.owner_user_id)
        .maybeSingle();
      if (owner?.phone) {
        const { sendTransactionalSms } = await import("./comms.server");
        await sendTransactionalSms({
          to: owner.phone,
          message: `Twende Meru: hire ${quote.reference} is paid (KES ${paidTotal.toLocaleString("en-KE")}). Open the app > Hire cars to prepare the handover.`,
          eventType: "hire_owner_paid_sms",
          idempotencyKey: `hire-owner-sms:${paymentIntentId}`,
          context: { userId: result.owner_user_id, paymentIntentId },
        }).catch((error) => console.error("owner hire sms failed", error));
      }
    }
    const { autoSignOwner } = await import("./agreements.server");
    await autoSignOwner(quote.id).catch((error) => console.error("owner auto-sign failed", error));
    await audit(null, "hire_payment_settled", "hire_quote", quote.id, {
      payment_intent_id: paymentIntentId,
      mpesa_receipt: receipt,
      gross_amount: result.gross_amount ?? intent?.amount ?? null,
      platform_fee_amount: fee,
      owner_net_amount: result.owner_net_amount ?? null,
      commission_percent: result.commission_percent ?? null,
      payment_status: result.payment_status ?? null,
    });
  }
  return result;
}

/** Restore the customer's previous visibility/availability state after a failed or timed-out attempt. */
export async function markHirePaymentFailure(
  paymentIntentId: string,
  status: "failed" | "cancelled" | "timed_out",
) {
  const { data: intent } = await supabaseAdmin
    .from("payment_intents")
    .select("hire_quote_id")
    .eq("id", paymentIntentId)
    .maybeSingle();
  if (!intent?.hire_quote_id) return;
  const quote = await loadQuote(intent.hire_quote_id);
  const paid = Number(quote.payment_paid_total ?? 0);
  const minimum = firstPaymentMinimum(quote);
  const hasThreshold = paid >= minimum;
  await supabaseAdmin
    .from("hire_quotes")
    .update({
      payment_status: hasThreshold ? (paid >= finalTotal(quote) ? "paid" : "partial") : status,
      payment_hold_expires_at: null,
    })
    .eq("id", quote.id);
}

/** Sends the approved reminder channels selected by a vehicle owner/authorized driver. */
export async function sendHirePaymentReminder(input: {
  quote: HirePaymentQuote;
  actorId: string;
  amount: number;
  intentId: string;
  channels: Array<"sms" | "email" | "whatsapp">;
}) {
  const [{ data: preferences }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from("notification_preferences")
      .select("sms_enabled, email_enabled, whatsapp_enabled, whatsapp_opted_in_at")
      .eq("user_id", input.quote.requester_id)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("phone, email, full_name")
      .eq("id", input.quote.requester_id)
      .maybeSingle(),
  ]);
  const reference = input.quote.reference;
  const amountText = `KES ${Math.round(input.amount).toLocaleString("en-KE")}`;
  const dueDate = new Date().toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" });
  const body = `Payment reminder for hire ${reference}: ${amountText} is requested now. Open Twende Meru Rides to pay by M-Pesa.`;
  const results: Record<string, string> = {};

  try {
    const { notify } = await import("./notifications.server");
    await notify({
      userId: input.quote.requester_id,
      templateCode: "hire_payment_reminder",
      title: "Hire payment requested",
      body,
      dedupeKey: `hire-payment-reminder:${input.intentId}`,
      payload: { hireQuoteId: input.quote.id, intentId: input.intentId, amount: input.amount },
    });
  } catch (error) {
    console.error("hire in-app reminder failed", error);
  }

  const sends: Promise<void>[] = [];
  if (!input.channels.includes("sms")) results["sms"] = "not_selected";
  else if (preferences?.sms_enabled === false) results["sms"] = "preference_disabled";
  else if (!(input.quote.contact_phone ?? profile?.phone)) results["sms"] = "no_phone";
  else {
    sends.push(
      (async () => {
        const { sendTransactionalSms } = await import("./comms.server");
        const result = await sendTransactionalSms({
          to: input.quote.contact_phone ?? profile!.phone!,
          message: body,
          eventType: "hire_payment_reminder",
          idempotencyKey: `hire-payment-reminder:sms:${input.intentId}`,
          context: { userId: input.quote.requester_id },
        });
        results["sms"] = result.sent ? "sent" : "failed";
      })(),
    );
  }

  if (!input.channels.includes("email")) results["email"] = "not_selected";
  else if (preferences?.email_enabled === false) results["email"] = "preference_disabled";
  else if (!profile?.email) results["email"] = "no_email";
  else {
    sends.push(
      (async () => {
        const { emailTemplate } = await import("./notifications.server");
        const result = await emailTemplate({
          userId: input.quote.requester_id,
          template: {
            code: "hire_payment_reminder",
            data: {
              name: profile?.full_name ?? "Customer",
              reference,
              amount: amountText,
              dueDate,
            },
          },
          eventType: "hire_payment_reminder",
          idempotencyKey: `hire-payment-reminder:email:${input.intentId}`,
        });
        results["email"] = result.delivered ? "sent" : result.reason;
      })(),
    );
  }

  if (!input.channels.includes("whatsapp")) results["whatsapp"] = "not_selected";
  else if (preferences?.whatsapp_enabled !== true || !preferences.whatsapp_opted_in_at) {
    results["whatsapp"] = "consent_not_enabled";
  } else {
    sends.push(
      (async () => {
        const { sendHirePaymentReminderTemplate } = await import("./whatsapp-utility.server");
        const result = await sendHirePaymentReminderTemplate({
          userId: input.quote.requester_id,
          quoteId: input.quote.id,
          reference,
          amount: amountText,
          dueDate,
          idempotencyKey: `hire-payment-reminder:whatsapp:${input.intentId}`,
        });
        results["whatsapp"] = result.status;
      })(),
    );
  }

  const settled = await Promise.allSettled(sends);
  settled.forEach((result) => {
    if (result.status === "rejected") console.error("hire reminder delivery failed", result.reason);
  });
  return { channels: results };
}

export async function getHireCommissionPercent() {
  return commissionPercent();
}

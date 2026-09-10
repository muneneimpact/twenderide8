import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Whether the app may take digital money right now. Honest, never simulated. */
export const getPaymentGate = createServerFn({ method: "GET" }).handler(async () => {
  const { getPaymentProvider, paymentMode } = await import("./adapters/payment.server");
  const provider = getPaymentProvider();
  const mode = paymentMode();
  return {
    provider: provider.name,
    mode,
    configured: provider.configured,
    liveBlocked: mode === "live" && !provider.configured,
    message: provider.configured
      ? "Twende Payments is connected."
      : "Twende Payments is not configured yet, so M-Pesa payments are unavailable. Cash still works.",
  };
});

/**
 * Starts an STK Push. If the provider is not configured this returns a blocked
 * result — it never pretends a payment succeeded.
 */
export const startStkPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPaymentProvider } = await import("./adapters/payment.server");

    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", data.rideId)
      .eq("customer_id", context.userId)
      .maybeSingle();
    if (!ride) throw new Error("Ride not found.");
    if (ride.payment_method !== "stk_push") throw new Error("This ride is a cash ride.");
    if (ride.payment_status === "paid") {
      return { status: "paid" as const, blocked: false, message: "This ride is already paid." };
    }

    const { data: latest } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("ride_id", ride.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) throw new Error("No payment record exists for this ride.");

    // A finished attempt is never reused: a retry gets its own transaction so
    // an old result can never be mistaken for the new one.
    let intent = latest;
    if (["failed", "cancelled", "timed_out"].includes(latest.status)) {
      const { data: fresh } = await supabaseAdmin
        .from("payment_intents")
        .insert({
          ride_id: ride.id,
          customer_id: ride.customer_id,
          method: "stk_push",
          amount: ride.total_fare,
          msisdn: latest.msisdn,
          status: "pending",
          idempotency_key: `retry:${ride.id}:${Date.now()}`,
        })
        .select("*")
        .single();
      if (fresh) intent = fresh;
    }

    const provider = getPaymentProvider();
    const result = await provider.initiateStkPush({
      intentId: intent.id,
      rideReference: ride.reference,
      amount: Number(ride.total_fare),
      msisdn: intent.msisdn ?? "",
      idempotencyKey: intent.idempotency_key,
    });

    const intentStatus = result.status === "blocked_provider_gate" ? "failed" : result.status;
    await supabaseAdmin
      .from("payment_intents")
      .update({
        status: intentStatus,
        provider: result.provider,
        mode: result.mode,
        provider_reference: result.providerReference,
        provider_request: result.request as never,
        provider_response: result.response as never,
        failure_reason: result.accepted ? null : result.message,
      })
      .eq("id", intent.id);

    await supabaseAdmin.from("rides").update({ payment_status: intentStatus }).eq("id", ride.id);

    return {
      status: result.status,
      blocked: result.status === "blocked_provider_gate",
      message: result.message,
    };
  });

export const getPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    let { data: intent } = await context.supabase
      .from("payment_intents")
      .select(
        "id, status, mode, provider, provider_reference, provider_response, failure_reason, amount, msisdn, created_at",
      )
      .eq("ride_id", data.rideId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: ride } = await context.supabase
      .from("rides")
      .select("payment_status, payment_method, total_fare")
      .eq("id", data.rideId)
      .maybeSingle();
    return { intent, ride };
  });

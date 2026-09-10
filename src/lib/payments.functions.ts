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
      ? "Payment provider connected."
      : mode === "live"
        ? "Live STK Push is blocked until the payment provider credentials and documentation are configured."
        : "Test mode: STK Push requests are recorded but no live request is sent and no payment is ever auto-confirmed.",
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

    const { data: intent } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("ride_id", ride.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!intent) throw new Error("No payment intent exists for this ride.");

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
    const { data: intent } = await context.supabase
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

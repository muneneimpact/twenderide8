import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Whether the app may take digital money right now. Honest, never simulated. */
export const getPaymentGate = createServerFn({ method: "GET" }).handler(async () => {
  const { getPaymentProvider, paymentMode } = await import("./adapters/payment.server");
  const provider = getPaymentProvider();
  const readiness = provider.readiness();
  return {
    provider: provider.name,
    mode: paymentMode(),
    configured: readiness.configured,
    missing: readiness.missing,
    message: readiness.message,
  };
});

/**
 * Starts an STK Push. If the provider is not configured, this returns a blocked
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
    if (ride.payment_status === "paid") return { status: "paid" as const, message: "Already paid." };

    const { data: intent } = await supabaseAdmin
      .from("payment_intents")
      .select("*")
      .eq("ride_id", ride.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!intent) throw new Error("No payment intent for this ride.");

    const provider = getPaymentProvider();
    const result = await provider.stkPush({
      amount: Number(ride.total_fare),
      msisdn: intent.msisdn ?? "",
      reference: ride.reference,
      description: `Twende Ride ${ride.reference}`,
      idempotencyKey: intent.idempotency_key,
    });

    await supabaseAdmin
      .from("payment_intents")
      .update({
        status: result.status,
        provider: provider.name,
        provider_reference: result.provider_reference ?? null,
        provider_message: result.message,
        last_attempt_at: new Date().toISOString(),
        attempts: intent.attempts + 1,
      })
      .eq("id", intent.id);

    const rideStatus =
      result.status === "paid"
        ? "paid"
        : result.status === "awaiting_confirmation"
          ? "awaiting_confirmation"
          : result.status === "failed"
            ? "failed"
            : "pending";
    await supabaseAdmin.from("rides").update({ payment_status: rideStatus }).eq("id", ride.id);

    if (result.status === "paid") {
      const { settleRide } = await import("./ledger.server");
      if (ride.status === "trip_completed") await settleRide(ride.id);
    }

    return { status: result.status, message: result.message, blocked: result.blocked ?? false };
  });

export const getPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: intent } = await context.supabase
      .from("payment_intents")
      .select("*")
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

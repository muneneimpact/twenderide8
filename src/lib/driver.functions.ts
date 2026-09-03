import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Driver dashboard: approval state, active vehicle, wallet, live offers. */
export const getDriverHome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: driver } = await supabase.from("drivers").select("*").eq("id", userId).maybeSingle();
    const { data: vehicles } = await supabase.from("vehicles").select("*").eq("owner_driver_id", userId);
    const { data: documents } = await supabase.from("documents").select("*").eq("subject_user_id", userId);
    const { data: wallet } = await supabase.from("wallets").select("*").eq("driver_id", userId).maybeSingle();
    const { data: offers } = await supabase
      .from("driver_offers")
      .select("*")
      .eq("driver_id", userId)
      .eq("status", "offered")
      .gt("expires_at", new Date().toISOString());
    const { data: activeRide } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", userId)
      .in("status", ["driver_assigned", "driver_arriving", "driver_arrived", "trip_started"])
      .maybeSingle();
    const { data: recent } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", userId)
      .in("status", ["trip_completed", "cancelled_by_customer", "cancelled_by_driver"])
      .order("requested_at", { ascending: false })
      .limit(15);

    // Where the trip starts and ends, so the console can show the route map.
    let activeRoute: {
      pickup: { lat: number; lng: number };
      dropoff: { lat: number; lng: number };
      pickup_address: string | null;
      dropoff_address: string | null;
      pickup_notes: string | null;
      distance_km: number;
    } | null = null;
    if (activeRide) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: quote } = await supabaseAdmin
        .from("route_quotes")
        .select(
          "pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, pickup_notes, distance_km",
        )
        .eq("id", activeRide.quote_id)
        .maybeSingle();
      if (quote) {
        activeRoute = {
          pickup: { lat: Number(quote.pickup_lat), lng: Number(quote.pickup_lng) },
          dropoff: { lat: Number(quote.dropoff_lat), lng: Number(quote.dropoff_lng) },
          pickup_address: quote.pickup_address,
          dropoff_address: quote.dropoff_address,
          pickup_notes: quote.pickup_notes,
          distance_km: Number(quote.distance_km),
        };
      }
    }

    // Contact card for the person being carried, so the driver can chat or call.
    let customer: { id: string; full_name: string | null; phone: string | null } | null = null;
    if (activeRide) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone")
        .eq("id", activeRide.customer_id)
        .maybeSingle();
      customer = profile ?? { id: activeRide.customer_id, full_name: null, phone: null };
    }

    return {
      driver,
      vehicles: vehicles ?? [],
      documents: documents ?? [],
      wallet,
      offers: offers ?? [],
      activeRide,
      activeRoute,
      customer,
      recent: recent ?? [],
    };
  });

/** Going online requires an approved driver record and an approved active vehicle. */
export const setDriverOnline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ online: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: driver } = await supabase
      .from("drivers")
      .select("status, active_vehicle_id")
      .eq("id", userId)
      .maybeSingle();
    if (!driver) throw new Error("No driver profile found.");

    if (data.online) {
      const blockers: string[] = [];
      if (driver.status !== "approved") blockers.push("Your driver account is not approved yet.");
      if (!driver.active_vehicle_id) blockers.push("Select an active vehicle first.");
      if (driver.active_vehicle_id) {
        const { data: vehicle } = await supabase
          .from("vehicles")
          .select("status")
          .eq("id", driver.active_vehicle_id)
          .maybeSingle();
        if (vehicle?.status !== "approved") blockers.push("Your active vehicle is not approved yet.");
      }
      if (blockers.length) return { online: false, blockers };
    }

    const { error } = await supabase
      .from("drivers")
      .update({ is_online: data.online })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { online: data.online, blockers: [] as string[] };
  });

export const setActiveVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ vehicleId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("drivers")
      .update({ active_vehicle_id: data.vehicleId })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Location ping. Only stored against a ride when the driver is on that ride. */
export const pushDriverLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy_m: z.number().nonnegative().max(20000).optional(),
        heading: z.number().optional().nullable(),
        speed_kph: z.number().optional().nullable(),
        rideId: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("drivers")
      .update({
        last_lat: data.lat,
        last_lng: data.lng,
        last_accuracy_m: data.accuracy_m ?? null,
        last_location_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (data.rideId) {
      const { data: ride } = await supabase
        .from("rides")
        .select("id, status")
        .eq("id", data.rideId)
        .eq("driver_id", userId)
        .maybeSingle();
      if (ride && ["driver_assigned", "driver_arriving", "driver_arrived", "trip_started"].includes(ride.status)) {
        await supabase.from("ride_locations").insert({
          ride_id: ride.id,
          driver_id: userId,
          lat: data.lat,
          lng: data.lng,
          accuracy_m: data.accuracy_m ?? null,
          heading: data.heading ?? null,
          speed_kph: data.speed_kph ?? null,
        });
      }
    }
    return { ok: true };
  });

/** Atomic accept: the database function guarantees only one driver wins. */
export const acceptOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ offerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notify, audit } = await import("./notifications.server");

    const { data: offer } = await supabaseAdmin
      .from("driver_offers")
      .select("ride_id, vehicle_id, driver_id, status, expires_at")
      .eq("id", data.offerId)
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (!offer) return { ok: false, reason: "offer_not_found", ride_id: null };
    if (offer.status !== "offered" || new Date(offer.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: "offer_expired", ride_id: null };
    }
    const { data: result, error } = await supabaseAdmin.rpc("accept_ride_offer", {
      _ride_id: offer.ride_id,
      _driver_id: context.userId,
      _vehicle_id: offer.vehicle_id!,
      _grace_seconds: 120,
    });
    if (error) {
      // The function raises when another driver already won the race.
      return { ok: false, reason: error.message, ride_id: null };
    }
    const ride = Array.isArray(result) ? result[0] : result;
    if (!ride) return { ok: false, reason: "ride_already_taken", ride_id: null };

    await supabaseAdmin
      .from("driver_offers")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", data.offerId);
    await supabaseAdmin
      .from("driver_offers")
      .update({ status: "superseded", responded_at: new Date().toISOString() })
      .eq("ride_id", ride.id)
      .eq("status", "offered");
    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: ride.id,
      status: "driver_assigned",
      actor_id: context.userId,
      actor_role: "driver",
    });
    await notify({
      userId: ride.customer_id,
      templateCode: "driver_assigned",
      title: "Driver on the way",
      body: `A driver accepted ride ${ride.reference} and is heading to your pickup point.`,
      rideId: ride.id,
      critical: true,
    });
    await audit(context.userId, "offer_accepted", "ride", ride.id, {});
    return { ok: true, reason: "assigned", ride_id: ride.id };
  });

export const declineOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ offerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("driver_offers")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", data.offerId)
      .eq("driver_id", context.userId)
      .eq("status", "offered");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const transitions: Record<string, string[]> = {
  driver_assigned: ["driver_arriving", "cancelled_by_driver"],
  driver_arriving: ["driver_arrived", "cancelled_by_driver"],
  driver_arrived: ["trip_started", "cancelled_by_driver"],
  trip_started: ["trip_completed"],
};

/** Guarded driver-side state machine. Illegal jumps are rejected server-side. */
export const advanceRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rideId: z.string().uuid(),
        next: z.enum(["driver_arriving", "driver_arrived", "trip_started", "trip_completed", "cancelled_by_driver"]),
        note: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { settleRide } = await import("./ledger.server");
    const { notify, emailTemplate, audit } = await import("./notifications.server");
    const { checkTripMilestone } = await import("./milestones.server");

    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", data.rideId)
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (!ride) throw new Error("Ride not found.");

    const allowed = transitions[ride.status] ?? [];
    if (!allowed.includes(data.next)) {
      throw new Error(`Cannot move a ride from ${ride.status} to ${data.next}.`);
    }

    const now = new Date().toISOString();
    const patch: {
      status: typeof data.next;
      started_at?: string;
      completed_at?: string;
      cancelled_by?: string;
      cancellation_reason?: string | null;
    } = { status: data.next };
    if (data.next === "trip_started") patch.started_at = now;
    if (data.next === "trip_completed") patch.completed_at = now;
    if (data.next === "cancelled_by_driver") {
      patch.cancelled_by = "driver";
      patch.cancellation_reason = data.note ?? null;
    }

    const { error } = await supabaseAdmin
      .from("rides")
      .update(patch)
      .eq("id", ride.id)
      .eq("status", ride.status);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: ride.id,
      status: data.next,
      actor_id: context.userId,
      actor_role: "driver",
      note: data.note ?? null,
    });

    if (data.next === "trip_completed") {
      const settlement = await settleRide(ride.id);
      await notify({
        userId: ride.customer_id,
        templateCode: "trip_completed",
        title: "Trip completed",
        body: `Ride ${ride.reference} is complete. Total KES ${Number(ride.total_fare).toFixed(2)}.`,
        rideId: ride.id,
        critical: true,
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
            when: new Date(now).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }),
            pickup: quote?.pickup_address ?? "Pickup point",
            dropoff: quote?.dropoff_address ?? "Destination",
            distanceKm: Number(quote?.distance_km ?? 0),
            fare: `KES ${Number(ride.total_fare).toFixed(2)}`,
            paymentMethod: ride.payment_method === "cash" ? "Cash" : "M-PESA",
          },
        },
        eventType: "trip_receipt",
        idempotencyKey: `trip-receipt:${ride.id}`,
        rideId: ride.id,
      });
      await checkTripMilestone(ride.customer_id);
      await audit(context.userId, "ride_completed", "ride", ride.id, settlement);
      return { status: data.next, settlement };
    }

    if (data.next === "driver_arrived" || data.next === "driver_arriving") {
      await notify({
        userId: ride.customer_id,
        templateCode: data.next,
        title: data.next === "driver_arrived" ? "Your driver has arrived" : "Driver approaching",
        body:
          data.next === "driver_arrived"
            ? "Your driver is at the pickup point."
            : "Your driver is on the way to your pickup point.",
        rideId: ride.id,
        critical: data.next === "driver_arrived",
      });
    }

    if (data.next === "cancelled_by_driver") {
      await notify({
        userId: ride.customer_id,
        templateCode: "ride_cancelled",
        title: "Driver cancelled",
        body: "Your driver cancelled. You can request another taxi at no charge.",
        rideId: ride.id,
        critical: true,
      });
    }

    return { status: data.next, settlement: null };
  });

/** Driver cash-collection confirmation for cash rides. */
export const confirmCashCollected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id, payment_method, payment_status")
      .eq("id", data.rideId)
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (!ride) throw new Error("Ride not found.");
    if (ride.payment_method !== "cash") throw new Error("This ride is not a cash ride.");
    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: ride.id,
      status: "trip_completed",
      actor_id: context.userId,
      actor_role: "driver",
      note: "Cash collected from customer",
    });
    return { ok: true };
  });

export const getDriverWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: wallet } = await context.supabase
      .from("wallets")
      .select("*")
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (!wallet) {
      return { wallet: null, entries: [], withdrawals: [], periods: null, owedToPlatform: 0 };
    }
    const { data: entries } = await context.supabase
      .from("wallet_ledger")
      .select("*")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(500);
    const { data: withdrawals } = await context.supabase
      .from("withdrawals")
      .select("*")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const rows = entries ?? [];

    // Earnings are computed from the trips themselves, not just the ledger:
    // cash trips never credit the wallet (the customer paid the driver
    // directly), so ledger-only maths showed zero for cash work.
    const { data: completed } = await context.supabase
      .from("rides")
      .select("id, reference, payment_method, payment_status, total_fare, commission_amount, completed_at")
      .eq("driver_id", context.userId)
      .eq("status", "trip_completed")
      .order("completed_at", { ascending: false })
      .limit(500);

    const trips = (completed ?? []).map((ride) => ({
      id: ride.id,
      reference: ride.reference,
      source: ride.payment_method === "cash" ? ("cash" as const) : ("system" as const),
      gross: Number(ride.total_fare),
      commission: Number(ride.commission_amount),
      net: Number((Number(ride.total_fare) - Number(ride.commission_amount)).toFixed(2)),
      completed_at: ride.completed_at ?? new Date().toISOString(),
    }));

    const nairobiDay = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date(iso));
    const now = new Date();
    const todayKey = nairobiDay(now.toISOString());
    const weekStart = new Date(now.getTime() - 6 * 86400000).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const bucket = (within: (t: (typeof trips)[number]) => boolean) => {
      const scoped = trips.filter(within);
      const sum = (source: "cash" | "system" | "all") =>
        Number(
          scoped
            .filter((t) => source === "all" || t.source === source)
            .reduce((s, t) => s + t.net, 0)
            .toFixed(2),
        );
      return { cash: sum("cash"), system: sum("system"), all: sum("all") };
    };

    const earnings = {
      today: bucket((t) => nairobiDay(t.completed_at) === todayKey),
      week: bucket((t) => new Date(t.completed_at).getTime() >= weekStart),
      month: bucket((t) => new Date(t.completed_at).getTime() >= monthStart),
      lifetime: bucket(() => true),
    };

    // Backwards-compatible take-home figures (all sources).
    const periods = { today: earnings.today.all, week: earnings.week.all, month: earnings.month.all };

    // Cash trips: the driver holds the customer's money, so the platform
    // commission is owed. Settlements reduce the outstanding amount.
    const owedRaw = rows
      .filter((e) => e.entry_type === "cash_commission_debit")
      .reduce((s, e) => s + Math.abs(Number(e.amount)), 0);
    const settled = rows
      .filter((e) => e.entry_type === "top_up" && (e.reason ?? "").includes("commission settlement"))
      .reduce((s, e) => s + Number(e.amount), 0);
    const owedToPlatform = Number(Math.max(0, owedRaw - settled).toFixed(2));

    return {
      wallet,
      entries: rows,
      withdrawals: withdrawals ?? [],
      trips,
      earnings,
      periods,
      owedToPlatform,
    };
  });

/**
 * Driver settles the commission they owe on cash trips by paying the platform
 * over M-PESA STK. Nothing is marked paid here — only a verified provider
 * callback can do that.
 */
export const payPlatformDues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ amount: z.number().positive().max(500000), msisdn: z.string().min(9).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPaymentProvider } = await import("./adapters/payment.server");
    const { normaliseKenyanPhone } = await import("./phone");

    const phone = normaliseKenyanPhone(data.msisdn);
    if (!phone) throw new Error("Enter a valid Kenyan M-PESA number.");

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (!wallet) throw new Error("No wallet found for this driver.");

    const idempotencyKey = `dues:${context.userId}:${Math.round(data.amount * 100)}:${Date.now()}`;
    const result = await getPaymentProvider().initiateStkPush({
      intentId: wallet.id,
      rideReference: "platform-dues",
      amount: data.amount,
      msisdn: phone,
      idempotencyKey,
    });

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "driver",
      action: "driver.pay_platform_dues",
      entity_type: "wallet",
      entity_id: wallet.id,
      metadata: {
        amount: data.amount,
        status: result.status,
        provider: result.provider,
        mode: result.mode,
        provider_reference: result.providerReference,
      } as never,
    });

    return {
      accepted: result.accepted,
      blocked: result.status === "blocked_provider_gate",
      message: result.accepted
        ? "Payment prompt sent. Your balance updates only once the payment is confirmed."
        : result.message,
    };
  });

/**
 * Driver asks the customer to pay the fare into the system over M-PESA STK.
 * A cash ride is switched to a system payment first so the money is settled
 * through the platform instead of hand-to-hand.
 */
export const requestCustomerPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ rideId: z.string().uuid(), msisdn: z.string().min(9).max(20).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPaymentProvider } = await import("./adapters/payment.server");
    const { normaliseKenyanPhone } = await import("./phone");

    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id, reference, customer_id, total_fare, payment_method, payment_status, ledger_posted_at")
      .eq("id", data.rideId)
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (!ride) throw new Error("Ride not found.");
    if (ride.payment_status === "paid") {
      return { accepted: true, blocked: false, message: "This ride is already paid." };
    }
    if (ride.ledger_posted_at) throw new Error("This ride has already been settled.");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", ride.customer_id)
      .maybeSingle();
    const phone = normaliseKenyanPhone(data.msisdn ?? profile?.phone ?? "");
    if (!phone) throw new Error("No valid M-PESA number for this customer.");

    if (ride.payment_method !== "stk_push") {
      await supabaseAdmin
        .from("rides")
        .update({ payment_method: "stk_push", payment_status: "pending" })
        .eq("id", ride.id);
    }

    const idempotencyKey = `driver_prompt:${ride.id}:${Date.now()}`;
    const { data: intent } = await supabaseAdmin
      .from("payment_intents")
      .insert({
        ride_id: ride.id,
        customer_id: ride.customer_id,
        method: "stk_push",
        amount: ride.total_fare,
        msisdn: phone,
        status: "pending",
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (!intent) throw new Error("Could not start the payment. Try again.");

    const result = await getPaymentProvider().initiateStkPush({
      intentId: intent.id,
      rideReference: ride.reference,
      amount: Number(ride.total_fare),
      msisdn: phone,
      idempotencyKey,
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
      accepted: result.accepted,
      blocked: result.status === "blocked_provider_gate",
      message: result.accepted
        ? "Payment prompt sent to the customer. The trip is only marked paid once the payment is confirmed."
        : result.message,
    };
  });


export const requestWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ amount: z.number().positive().max(500000), msisdn: z.string().min(9).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id, cached_balance")
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (!wallet) throw new Error("No wallet found.");
    if (Number(wallet.cached_balance) < data.amount) {
      throw new Error("Withdrawal amount is more than your available balance.");
    }
    const { data: created, error } = await supabaseAdmin
      .from("withdrawals")
      .insert({
        wallet_id: wallet.id,
        requested_by: context.userId,
        amount: data.amount,
        destination: normaliseKenyanPhone(data.msisdn),
        status: "pending",
        idempotency_key: `wd:${context.userId}:${Date.now()}`,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { withdrawal: created };
  });

/**
 * Open marketplace board: every ride still searching for a driver.
 * Only approved, authorised drivers with an approved vehicle may see it.
 */
export const listOpenRides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { expireStaleDispatch } = await import("./dispatch.server");

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("status, active_vehicle_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!driver || driver.status !== "approved") {
      return { eligible: false, reason: "Your driver account is not approved yet.", rides: [] };
    }
    if (!driver.active_vehicle_id) {
      return { eligible: false, reason: "Select an active vehicle first.", rides: [] };
    }
    const { data: authorised } = await supabaseAdmin.rpc("may_drive_vehicle", {
      _user_id: context.userId,
      _vehicle_id: driver.active_vehicle_id,
    });
    if (!authorised) {
      return {
        eligible: false,
        reason: "You are not authorised on this vehicle yet — operations must approve it.",
        rides: [],
      };
    }

    await expireStaleDispatch();
    const { data: rides } = await supabaseAdmin
      .from("rides")
      .select("id, reference, total_fare, payment_method, requested_at, quote_id")
      .eq("status", "searching")
      .order("requested_at", { ascending: true })
      .limit(20);

    const quoteIds = (rides ?? []).map((r) => r.quote_id);
    const { data: quotes } = quoteIds.length
      ? await supabaseAdmin
          .from("route_quotes")
          .select(
            "id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, distance_km, duration_minutes, vehicle_class",
          )
          .in("id", quoteIds)
      : { data: [] };

    return {
      eligible: true,
      reason: null as string | null,
      rides: (rides ?? []).map((ride) => {
        const quote = (quotes ?? []).find((q) => q.id === ride.quote_id) ?? null;
        return {
          id: ride.id,
          reference: ride.reference,
          total_fare: Number(ride.total_fare),
          payment_method: ride.payment_method,
          requested_at: ride.requested_at,
          vehicle_class: quote?.vehicle_class ?? null,
          pickup_address: quote?.pickup_address ?? null,
          dropoff_address: quote?.dropoff_address ?? null,
          distance_km: quote ? Number(quote.distance_km) : null,
          duration_minutes: quote ? Number(quote.duration_minutes) : null,
          pickup: quote ? { lat: Number(quote.pickup_lat), lng: Number(quote.pickup_lng) } : null,
          dropoff: quote ? { lat: Number(quote.dropoff_lat), lng: Number(quote.dropoff_lng) } : null,
        };
      }),
    };
  });

/**
 * Claim a ride straight from the open board. A short-lived offer is written
 * first so the same atomic database function decides the winner.
 */
export const claimRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notify, audit } = await import("./notifications.server");

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("status, active_vehicle_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!driver || driver.status !== "approved" || !driver.active_vehicle_id) {
      return { ok: false, reason: "You are not cleared to accept rides yet.", ride_id: null };
    }

    // A driver may already have an offer row for this ride in any state
    // (expired, declined, superseded). The unique key is (ride_id, driver_id),
    // so refresh that row instead of inserting a duplicate.
    const { error: offerError } = await supabaseAdmin.from("driver_offers").upsert(
      {
        ride_id: data.rideId,
        driver_id: context.userId,
        vehicle_id: driver.active_vehicle_id,
        status: "offered",
        responded_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { onConflict: "ride_id,driver_id" },
    );
    if (offerError) return { ok: false, reason: offerError.message, ride_id: null };


    const { data: result, error } = await supabaseAdmin.rpc("accept_ride_offer", {
      _ride_id: data.rideId,
      _driver_id: context.userId,
      _vehicle_id: driver.active_vehicle_id,
      _grace_seconds: 120,
    });
    if (error) return { ok: false, reason: error.message, ride_id: null };
    const ride = Array.isArray(result) ? result[0] : result;
    if (!ride) return { ok: false, reason: "Another driver already took this ride.", ride_id: null };

    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: ride.id,
      status: "driver_assigned",
      actor_id: context.userId,
      actor_role: "driver",
    });
    await notify({
      userId: ride.customer_id,
      templateCode: "driver_assigned",
      title: "Driver on the way",
      body: `A driver accepted ride ${ride.reference} and is heading to your pickup point.`,
      rideId: ride.id,
      critical: true,
    });
    await audit(context.userId, "open_ride_claimed", "ride", ride.id, {});
    return { ok: true, reason: "assigned", ride_id: ride.id };
  });

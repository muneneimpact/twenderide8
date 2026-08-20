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

    return {
      driver,
      vehicles: vehicles ?? [],
      documents: documents ?? [],
      wallet,
      offers: offers ?? [],
      activeRide,
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
    if (error) throw new Error(error.message);
    const outcome = result as unknown as { ok: boolean; reason: string; ride_id: string | null };
    if (!outcome.ok) return outcome;

    const { data: ride } = await supabaseAdmin
      .from("rides")
      .select("id, reference, customer_id")
      .eq("id", outcome.ride_id!)
      .maybeSingle();
    if (ride) {
      await notify({
        userId: ride.customer_id,
        templateCode: "driver_assigned",
        title: "Driver on the way",
        body: `A driver accepted ride ${ride.reference} and is heading to your pickup point.`,
        rideId: ride.id,
        critical: true,
      });
      await audit(context.userId, "offer_accepted", "ride", ride.id, {});
    }
    return outcome;
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
    const { notify, emailReceipt, audit } = await import("./notifications.server");

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
      await emailReceipt(
        ride.customer_id,
        `Twende Ride receipt — ${ride.reference}`,
        `Your trip ${ride.reference} is complete. Total: KES ${Number(ride.total_fare).toFixed(2)}.`,
      );
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
    if (!wallet) return { wallet: null, entries: [], withdrawals: [] };
    const { data: entries } = await context.supabase
      .from("wallet_ledger")
      .select("*")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(50);
    const { data: withdrawals } = await context.supabase
      .from("withdrawals")
      .select("*")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(20);
    return { wallet, entries: entries ?? [], withdrawals: withdrawals ?? [] };
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
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { withdrawal: created };
  });

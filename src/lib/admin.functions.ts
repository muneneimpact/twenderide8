import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const bandSchema = z.object({
  sort_order: z.number().int().min(0),
  admin_label: z.string().min(2).max(80),
  customer_explanation: z.string().max(200).optional().nullable(),
  lower_km: z.number().min(0),
  upper_km: z.number().min(0).nullable(),
  start_reduction_percent: z.number().min(0).max(90),
  end_reduction_percent: z.number().min(0).max(90),
  mode: z.enum(["linear", "fixed"]),
});

/* ---------------------------------- OPS ---------------------------------- */

/** Live operations board: active rides, online drivers, dispatch health. */
export const getOpsBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { expireStaleDispatch } = await import("./dispatch.server");
    await expireStaleDispatch();

    const [{ data: active }, { data: drivers }, { data: pendingDrivers }, { data: pendingVehicles }, { data: incidents }, { data: pendingDocuments }, { data: documentTypes }] =
      await Promise.all([
        supabaseAdmin
          .from("rides")
          .select("*")
          .in("status", ["searching", "driver_assigned", "driver_arriving", "driver_arrived", "trip_started"])
          .order("requested_at", { ascending: false }),
        supabaseAdmin
          .from("drivers")
          .select("id, is_online, status, last_lat, last_lng, last_location_at, cash_jobs_blocked, active_vehicle_id, rating, completed_rides")
          .eq("is_online", true),
        supabaseAdmin.from("drivers").select("*").eq("status", "pending"),
        supabaseAdmin.from("vehicles").select("*").eq("status", "pending"),
        supabaseAdmin.from("incidents").select("*").neq("status", "resolved").order("created_at", { ascending: false }),
        supabaseAdmin.from("documents").select("*").eq("status", "pending").order("created_at", { ascending: true }),
        supabaseAdmin.from("document_types").select("id, code, label, applies_to").eq("active", true),
      ]);

    // Full driver, vehicle and fleet registers so ops can manage, not just approve.
    const [{ data: allDrivers }, { data: allVehicles }, { data: allFleets }] = await Promise.all([
      supabaseAdmin.from("drivers").select("*").order("created_at", { ascending: false }).limit(200),
      supabaseAdmin.from("vehicles").select("*").order("created_at", { ascending: false }).limit(200),
      supabaseAdmin.from("fleets").select("*").order("created_at", { ascending: false }).limit(100),
    ]);

    // Applicant identity for every pending item so ops reviews a person, not a UUID.
    const applicantIds = [
      ...new Set([
        ...(pendingDrivers ?? []).map((d) => d.id),
        ...(pendingVehicles ?? []).map((v) => v.owner_driver_id).filter((v): v is string => Boolean(v)),
        ...(pendingDocuments ?? []).map((d) => d.subject_user_id).filter((v): v is string => Boolean(v)),
        ...(allDrivers ?? []).map((d) => d.id),
        ...(allFleets ?? []).map((f) => f.owner_id),
      ]),
    ];
    const { data: applicants } = applicantIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email, phone").in("id", applicantIds)
      : { data: [] };

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("rides")
      .select("status, total_fare, payment_method")
      .gte("requested_at", since);

    const rows = recent ?? [];
    return {
      activeRides: active ?? [],
      onlineDrivers: drivers ?? [],
      pendingDrivers: pendingDrivers ?? [],
      pendingVehicles: pendingVehicles ?? [],
      pendingDocuments: pendingDocuments ?? [],
      documentTypes: documentTypes ?? [],
      applicants: applicants ?? [],
      allDrivers: allDrivers ?? [],
      allVehicles: allVehicles ?? [],
      allFleets: allFleets ?? [],
      incidents: incidents ?? [],

      last24h: {
        requested: rows.length,
        completed: rows.filter((r) => r.status === "trip_completed").length,
        noDriver: rows.filter((r) => r.status === "no_driver_found").length,
        cancelled: rows.filter((r) => r.status.startsWith("cancelled")).length,
        gross: Number(
          rows
            .filter((r) => r.status === "trip_completed")
            .reduce((sum, r) => sum + Number(r.total_fare), 0)
            .toFixed(2),
        ),
      },
    };
  });

export const reviewApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["driver", "vehicle", "fleet", "document"]),
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "restricted", "pending"]),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notify, audit } = await import("./notifications.server");

    const table = { driver: "drivers", vehicle: "vehicles", fleet: "fleets", document: "documents" }[data.kind] as
      | "drivers"
      | "vehicles"
      | "fleets"
      | "documents";

    if (table === "documents") {
      const { error } = await supabaseAdmin
        .from("documents")
        .update({
          status: data.decision,
          rejection_reason: data.decision === "rejected" ? (data.note ?? "Not accepted") : null,
          reviewed_by: context.userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from(table).update({ status: data.decision }).eq("id", data.id);
      if (error) throw new Error(error.message);
      if (data.decision !== "approved" && table === "drivers") {
        await supabaseAdmin.from("drivers").update({ is_online: false }).eq("id", data.id);
      }
      if (table === "vehicles") {
        const { data: vehicle } = await supabaseAdmin
          .from("vehicles")
          .select("owner_driver_id")
          .eq("id", data.id)
          .maybeSingle();
        if (vehicle?.owner_driver_id) {
          if (data.decision === "approved") {
            // Approval is what authorises the owning driver to operate the car.
            const { data: existing } = await supabaseAdmin
              .from("driver_vehicle_authorisations")
              .select("id")
              .eq("vehicle_id", data.id)
              .eq("driver_id", vehicle.owner_driver_id)
              .is("revoked_at", null)
              .maybeSingle();
            if (!existing) {
              await supabaseAdmin
                .from("driver_vehicle_authorisations")
                .insert({ vehicle_id: data.id, driver_id: vehicle.owner_driver_id, granted_by: context.userId });
            }
          } else {
            await supabaseAdmin
              .from("driver_vehicle_authorisations")
              .update({ revoked_at: new Date().toISOString() })
              .eq("vehicle_id", data.id)
              .is("revoked_at", null);
          }
        }
      }
    }


    if (data.kind === "driver") {
      await notify({
        userId: data.id,
        templateCode: "driver_review",
        title: data.decision === "approved" ? "You are approved to drive" : "Driver account update",
        body:
          data.decision === "approved"
            ? "Your driver account was approved. You can now go online."
            : `Your driver account status is now ${data.decision}. ${data.note ?? ""}`.trim(),
        critical: true,
      });
    }
    await audit(context.userId, `${data.kind}_${data.decision}`, data.kind, data.id, { note: data.note ?? null });
    return { ok: true };
  });

export const opsCancelRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rideId: z.string().uuid(), reason: z.string().min(3).max(300) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { error } = await supabaseAdmin
      .from("rides")
      .update({
        status: "cancelled_by_system",
        cancelled_by: "ops",
        cancellation_reason: data.reason,
        cancellation_fee: 0,
      })
      .eq("id", data.rideId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("ride_status_events").insert({
      ride_id: data.rideId,
      status: "cancelled_by_system",
      actor_id: context.userId,
      actor_role: "ops_admin",
      note: data.reason,
    });
    await audit(context.userId, "ops_cancelled_ride", "ride", data.rideId, { reason: data.reason });
    return { ok: true };
  });

export const resolveIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), resolution: z.string().min(3).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("incidents")
      .update({ status: "resolved", resolution: data.resolution, assigned_to: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------------------- FINANCE -------------------------------- */

export const getFinanceBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, FINANCE } = await import("./authz.server");
    await requireRole(context.userId, FINANCE);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: wallets }, { data: withdrawals }, { data: refunds }, { data: entries }, { data: intents }] =
      await Promise.all([
        supabaseAdmin.from("wallets").select("*").order("cached_balance"),
        supabaseAdmin.from("withdrawals").select("*").order("created_at", { ascending: false }).limit(50),
        supabaseAdmin.from("refunds").select("*").order("created_at", { ascending: false }).limit(50),
        supabaseAdmin.from("wallet_ledger").select("*").order("created_at", { ascending: false }).limit(100),
        supabaseAdmin
          .from("payment_intents")
          .select("id, status, amount, mode, provider, created_at, ride_id")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    const ledger = entries ?? [];
    return {
      wallets: wallets ?? [],
      withdrawals: withdrawals ?? [],
      refunds: refunds ?? [],
      entries: ledger,
      intents: intents ?? [],
      totals: {
        commission: Number(
          ledger
            .filter((e) => e.entry_type === "platform_commission")
            .reduce((s, e) => s + Number(e.amount), 0)
            .toFixed(2),
        ),
        payouts: Number(
          ledger
            .filter((e) => e.entry_type === "withdrawal_success")
            .reduce((s, e) => s + Number(e.amount), 0)
            .toFixed(2),
        ),
        negativeWallets: (wallets ?? []).filter((w) => Number(w.cached_balance) < 0).length,
      },
    };
  });

/** Withdrawal review. Payout execution is gated on the payment provider. */
export const reviewWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "paid", "failed"]),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, FINANCE } = await import("./authz.server");
    await requireRole(context.userId, FINANCE);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { postLedgerEntry } = await import("./ledger.server");
    const { getPaymentProvider, paymentMode } = await import("./adapters/payment.server");
    const { audit } = await import("./notifications.server");

    const { data: withdrawal } = await supabaseAdmin
      .from("withdrawals")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!withdrawal) throw new Error("Withdrawal not found.");

    if (data.decision === "paid") {
      const provider = getPaymentProvider();
      if (!provider.configured && paymentMode() === "live") {
        throw new Error(
          "Payouts are blocked in live mode until the payment provider is configured. No money movement was recorded.",
        );
      }
      await postLedgerEntry({
        walletId: withdrawal.wallet_id,
        entryType: "withdrawal_success",
        amount: -Number(withdrawal.amount),
        withdrawalId: withdrawal.id,
        idempotencyKey: `withdrawal_paid:${withdrawal.id}`,
        actorId: context.userId,
        source: "finance",
        reason: data.note ?? "Withdrawal paid out",
        metadata: { mode: paymentMode() },
      });
    }

    const { error } = await supabaseAdmin
      .from("withdrawals")
      .update({ status: data.decision, review_note: data.note ?? null, reviewed_by: context.userId })
      .eq("id", withdrawal.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, `withdrawal_${data.decision}`, "withdrawal", withdrawal.id, {});
    return { ok: true };
  });

export const adjustWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        walletId: z.string().uuid(),
        amount: z.number().refine((v) => v !== 0, "Amount cannot be zero."),
        reason: z.string().min(5).max(300),
        kind: z.enum(["bonus", "penalty", "manual_adjustment"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, FINANCE } = await import("./authz.server");
    await requireRole(context.userId, FINANCE);
    const { postLedgerEntry } = await import("./ledger.server");
    const { audit } = await import("./notifications.server");
    const result = await postLedgerEntry({
      walletId: data.walletId,
      entryType: data.kind,
      amount: data.amount,
      idempotencyKey: `adjust:${data.walletId}:${Date.now()}`,
      actorId: context.userId,
      source: "finance",
      reason: data.reason,
    });
    await audit(context.userId, "wallet_adjusted", "wallet", data.walletId, { amount: data.amount });
    return result;
  });

/* ------------------------------ SUPER ADMIN ------------------------------ */

export const getPricingWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: configs }, { data: policies }, { data: bands }, { data: modifiers }, { data: settings }] =
      await Promise.all([
        supabaseAdmin.from("fare_configs").select("*").order("vehicle_class").order("version", { ascending: false }),
        supabaseAdmin.from("distance_policies").select("*").order("version", { ascending: false }),
        supabaseAdmin.from("distance_bands").select("*").order("sort_order"),
        supabaseAdmin.from("pricing_modifiers").select("*").order("code"),
        supabaseAdmin.from("system_settings").select("*").order("key"),
      ]);
    return {
      configs: configs ?? [],
      policies: policies ?? [],
      bands: bands ?? [],
      modifiers: modifiers ?? [],
      settings: settings ?? [],
    };
  });

/** Validate + preview a band set before anything is published. */
export const previewDistancePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        vehicleClass: z.enum(["economy", "comfort", "xl"]),
        maxTotalReductionPercent: z.number().min(0).max(90),
        bands: z.array(bandSchema).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { loadPricingContext } = await import("./pricing.server");
    const { validateDistancePolicy, previewTable } = await import("./fare-engine");

    const policy = {
      id: "preview",
      name: "Preview",
      version: 0,
      max_total_reduction_percent: data.maxTotalReductionPercent,
      bands: data.bands.map((band) => ({
        ...band,
        customer_explanation: band.customer_explanation ?? null,
      })),
    };
    const issues = validateDistancePolicy(policy);
    const pricing = await loadPricingContext(data.vehicleClass);
    const rows = issues.length > 0
      ? []
      : previewTable(pricing.config, policy, pricing.modifiers, [1, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120]);
    return { issues, rows };
  });

/** Saves a new draft policy version. Publishing is a separate, explicit step. */
export const saveDistancePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(3).max(80),
        vehicleClass: z.enum(["economy", "comfort", "xl"]).nullable(),
        maxTotalReductionPercent: z.number().min(0).max(90),
        adminNotes: z.string().max(1000).optional(),
        bands: z.array(bandSchema).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { validateDistancePolicy } = await import("./fare-engine");
    const { audit } = await import("./notifications.server");

    const issues = validateDistancePolicy({
      id: "draft",
      name: data.name,
      version: 0,
      max_total_reduction_percent: data.maxTotalReductionPercent,
      bands: data.bands.map((b) => ({ ...b, customer_explanation: b.customer_explanation ?? null })),
    });
    if (issues.length > 0) {
      return { saved: false, issues, policyId: null };
    }

    const { data: latest } = await supabaseAdmin
      .from("distance_policies")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (latest?.version ?? 0) + 1;

    const { data: policy, error } = await supabaseAdmin
      .from("distance_policies")
      .insert({
        name: data.name,
        version,
        vehicle_class: data.vehicleClass,
        max_total_reduction_percent: data.maxTotalReductionPercent,
        admin_notes: data.adminNotes ?? null,
        state: "draft",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { error: bandError } = await supabaseAdmin.from("distance_bands").insert(
      data.bands.map((band) => ({
        policy_id: policy.id,
        sort_order: band.sort_order,
        admin_label: band.admin_label,
        customer_explanation: band.customer_explanation ?? null,
        lower_km: band.lower_km,
        upper_km: band.upper_km,
        start_reduction_percent: band.start_reduction_percent,
        end_reduction_percent: band.end_reduction_percent,
        mode: band.mode,
      })),
    );
    if (bandError) throw new Error(bandError.message);
    await audit(context.userId, "distance_policy_drafted", "distance_policy", policy.id, { version });
    return { saved: true, issues, policyId: policy.id };
  });

/** Publishing archives the previous published version; in-flight quotes keep their snapshot. */
export const publishDistancePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ policyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { validateDistancePolicy } = await import("./fare-engine");
    const { audit } = await import("./notifications.server");

    const { data: policy } = await supabaseAdmin
      .from("distance_policies")
      .select("*")
      .eq("id", data.policyId)
      .maybeSingle();
    if (!policy) throw new Error("Policy not found.");
    const { data: bands } = await supabaseAdmin
      .from("distance_bands")
      .select("*")
      .eq("policy_id", policy.id)
      .order("sort_order");

    const issues = validateDistancePolicy({
      id: policy.id,
      name: policy.name,
      version: policy.version,
      max_total_reduction_percent: Number(policy.max_total_reduction_percent),
      bands: (bands ?? []).map((band) => ({
        sort_order: band.sort_order,
        admin_label: band.admin_label,
        customer_explanation: band.customer_explanation,
        lower_km: Number(band.lower_km),
        upper_km: band.upper_km === null ? null : Number(band.upper_km),
        start_reduction_percent: Number(band.start_reduction_percent),
        end_reduction_percent: Number(band.end_reduction_percent),
        mode: band.mode as "linear" | "fixed",
      })),
    });
    if (issues.length > 0) return { published: false, issues };

    await supabaseAdmin
      .from("distance_policies")
      .update({ state: "archived", effective_to: new Date().toISOString() })
      .eq("state", "published");
    const { error } = await supabaseAdmin
      .from("distance_policies")
      .update({
        state: "published",
        published_at: new Date().toISOString(),
        published_by: context.userId,
        effective_from: new Date().toISOString(),
      })
      .eq("id", policy.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "distance_policy_published", "distance_policy", policy.id, {
      version: policy.version,
    });
    return { published: true, issues };
  });

export const saveFareConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        vehicleClass: z.enum(["boda", "economy", "comfort", "xl"]),
        base_fare: z.number().min(0),
        per_km: z.number().min(0),
        per_minute: z.number().min(0),
        minimum_fare: z.number().min(0),
        booking_fee: z.number().min(0),
        waiting_per_minute: z.number().min(0),
        free_waiting_minutes: z.number().int().min(0).max(60),
        cancellation_fee: z.number().min(0),
        cancellation_free_seconds: z.number().int().min(0).max(3600),
        commission_percent: z.number().min(0).max(60),
        rounding_rule: z.enum(["nearest_1", "nearest_5", "nearest_10", "up_5", "up_10"]),
        modifier_combination: z.enum(["additive", "compounded"]),
        max_surcharge_percent: z.number().min(0).max(200),
        publish: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");

    const { data: latest } = await supabaseAdmin
      .from("fare_configs")
      .select("version")
      .eq("vehicle_class", data.vehicleClass)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (latest?.version ?? 0) + 1;

    const { data: created, error } = await supabaseAdmin
      .from("fare_configs")
      .insert({
        vehicle_class: data.vehicleClass,
        version,
        base_fare: data.base_fare,
        per_km: data.per_km,
        per_minute: data.per_minute,
        minimum_fare: data.minimum_fare,
        booking_fee: data.booking_fee,
        waiting_per_minute: data.waiting_per_minute,
        free_waiting_minutes: data.free_waiting_minutes,
        cancellation_fee: data.cancellation_fee,
        cancellation_free_seconds: data.cancellation_free_seconds,
        commission_percent: data.commission_percent,
        rounding_rule: data.rounding_rule,
        modifier_combination: data.modifier_combination,
        max_surcharge_percent: data.max_surcharge_percent,
        state: data.publish ? "published" : "draft",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (data.publish) {
      await supabaseAdmin
        .from("fare_configs")
        .update({ state: "archived", effective_to: new Date().toISOString() })
        .eq("vehicle_class", data.vehicleClass)
        .eq("state", "published")
        .neq("id", created.id);
    }
    await audit(context.userId, data.publish ? "fare_config_published" : "fare_config_drafted", "fare_config", created.id, {
      version,
    });
    return { config: created };
  });

export const setModifier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        percent: z.number().min(0).max(200).optional(),
        active: z.boolean().optional(),
        state: z.enum(["draft", "published", "paused", "archived"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const patch: { percent?: number; active?: boolean; state?: "draft" | "published" | "paused" | "archived" } = {};
    if (data.percent !== undefined) patch.percent = data.percent;
    if (data.active !== undefined) patch.active = data.active;
    if (data.state !== undefined) patch.state = data.state;
    const { error } = await supabaseAdmin.from("pricing_modifiers").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "pricing_modifier_updated", "pricing_modifier", data.id, patch);
    return { ok: true };
  });

export const setSystemSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ key: z.string().min(2).max(80), value: z.string().max(400) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { error } = await supabaseAdmin
      .from("system_settings")
      .upsert(
        { key: data.key, value: data.value as never, updated_by: context.userId, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    await audit(context.userId, "system_setting_updated", "system_setting", data.key, { value: data.value });
    return { ok: true };
  });

export const listStaffUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("*");
    const ids = [...new Set((roles ?? []).map((r) => r.user_id))];
    const { data: profiles } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email, phone").in("id", ids)
      : { data: [] };
    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(60);
    return { roles: roles ?? [], profiles: profiles ?? [], auditLogs: logs ?? [] };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        role: z.enum(["customer", "driver", "fleet_owner", "ops_admin", "finance_admin", "super_admin"]),
        grant: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email.toLowerCase())
      .maybeSingle();
    if (!profile) throw new Error("No account found with that email address.");
    if (!data.grant && profile.id === context.userId && data.role === "super_admin") {
      throw new Error("You cannot remove your own super admin role.");
    }

    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: profile.id, role: data.role, granted_by: context.userId }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", profile.id)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    await audit(context.userId, data.grant ? "role_granted" : "role_revoked", "user", profile.id, {
      role: data.role,
    });
    return { ok: true };
  });

/* ------------------------------ FLEET OWNER ------------------------------ */

export const getFleetBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets } = await supabaseAdmin.from("fleets").select("*").eq("owner_id", context.userId);
    const fleetIds = (fleets ?? []).map((f) => f.id);
    if (fleetIds.length === 0) return { fleets: [], vehicles: [], drivers: [], wallet: null, entries: [], rides: [] };

    const { data: vehicles } = await supabaseAdmin.from("vehicles").select("*").in("fleet_id", fleetIds);
    const driverIds = (vehicles ?? []).map((v) => v.active_driver_id).filter(Boolean) as string[];
    const { data: drivers } = driverIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", driverIds)
      : { data: [] };
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("*")
      .eq("fleet_id", fleetIds[0]!)
      .maybeSingle();
    const { data: entries } = wallet
      ? await supabaseAdmin
          .from("wallet_ledger")
          .select("*")
          .eq("wallet_id", wallet.id)
          .order("created_at", { ascending: false })
          .limit(50)
      : { data: [] };
    const { data: rides } = await supabaseAdmin
      .from("rides")
      .select("*")
      .in("fleet_id", fleetIds)
      .order("requested_at", { ascending: false })
      .limit(30);
    return {
      fleets: fleets ?? [],
      vehicles: vehicles ?? [],
      drivers: drivers ?? [],
      wallet,
      entries: entries ?? [],
      rides: rides ?? [],
    };
  });

export const updateFleetSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fleetId: z.string().uuid(),
        settlement_mode: z.enum(["driver_wallet", "fleet_wallet", "split"]),
        driver_split_percent: z.number().min(0).max(100),
        cash_commission_liability: z.enum(["driver", "fleet"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { data: fleet } = await supabaseAdmin
      .from("fleets")
      .select("id")
      .eq("id", data.fleetId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!fleet) throw new Error("Fleet not found.");
    const { error } = await supabaseAdmin
      .from("fleets")
      .update({
        settlement_mode: data.settlement_mode,
        driver_split_percent: data.driver_split_percent,
        cash_commission_liability: data.cash_commission_liability,
      })
      .eq("id", fleet.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "fleet_settlement_updated", "fleet", fleet.id, data);
    return { ok: true };
  });

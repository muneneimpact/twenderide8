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

    const [
      { data: active },
      { data: drivers },
      { data: pendingDrivers },
      { data: pendingVehicles },
      { data: incidents },
      { data: pendingDocuments },
      { data: documentTypes },
    ] = await Promise.all([
      supabaseAdmin
        .from("rides")
        .select("*")
        .in("status", [
          "searching",
          "driver_assigned",
          "driver_arriving",
          "driver_arrived",
          "trip_started",
        ])
        .order("requested_at", { ascending: false }),
      supabaseAdmin
        .from("drivers")
        .select(
          "id, is_online, status, last_lat, last_lng, last_location_at, cash_jobs_blocked, active_vehicle_id, rating, completed_rides",
        )
        .eq("is_online", true),
      supabaseAdmin.from("drivers").select("*").eq("status", "pending"),
      supabaseAdmin.from("vehicles").select("*").eq("status", "pending"),
      supabaseAdmin
        .from("incidents")
        .select("*")
        .neq("status", "resolved")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("documents")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("document_types").select("id, code, label, applies_to").eq("active", true),
    ]);

    // Full driver, vehicle and fleet registers so ops can manage, not just approve.
    const [{ data: allDrivers }, { data: allVehicles }, { data: allFleets }] = await Promise.all([
      supabaseAdmin
        .from("drivers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("vehicles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("fleets").select("*").order("created_at", { ascending: false }).limit(100),
    ]);

    // Applicant identity for every pending item so ops reviews a person, not a UUID.
    const [{ data: deliveryRateProposals }] = await Promise.all([
      supabaseAdmin
        .from("fleet_delivery_rate_proposals")
        .select("*")
        .eq("status", "pending")
        .order("submitted_at", { ascending: true })
        .limit(100),
    ]);
    const pendingDeliveryRates = (deliveryRateProposals ?? []).map((proposal) => ({
      ...proposal,
      business_name: (() => {
        const fleet = (allFleets ?? []).find((row) => row.id === proposal.fleet_id);
        return fleet?.delivery_business_name ?? fleet?.business_name ?? "Delivery business";
      })(),
    }));

    const applicantIds = [
      ...new Set([
        ...(pendingDrivers ?? []).map((d) => d.id),
        ...(pendingVehicles ?? [])
          .map((v) => v.owner_driver_id)
          .filter((v): v is string => Boolean(v)),
        ...(pendingDocuments ?? [])
          .map((d) => d.subject_user_id)
          .filter((v): v is string => Boolean(v)),
        ...(allDrivers ?? []).map((d) => d.id),
        ...(allFleets ?? []).map((f) => f.owner_id),
      ]),
    ];
    const { data: applicants } = applicantIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, phone")
          .in("id", applicantIds)
      : { data: [] };

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("rides")
      .select("status, total_fare, payment_method")
      .gte("requested_at", since);

    const rows = recent ?? [];
    const pendingHireRows = (allVehicles ?? []).filter(
      (vehicle) => vehicle.hire_approval_status === "pending",
    );
    const hirePhotoPaths = [
      ...new Set(
        pendingHireRows
          .flatMap((vehicle) => [vehicle.photo_url, ...(vehicle.photo_urls ?? [])])
          .filter((path): path is string => Boolean(path)),
      ),
    ];
    const { data: signedHirePhotos } = hirePhotoPaths.length
      ? await supabaseAdmin.storage.from("vehicle-photos").createSignedUrls(hirePhotoPaths, 1800)
      : { data: [] };
    const hirePhotoMap = new Map(
      (signedHirePhotos ?? []).map((photo) => [photo.path, photo.signedUrl]),
    );
    const pendingHireVehicles = pendingHireRows.map((vehicle) => ({
      ...vehicle,
      review_photo_links: [
        ...new Set(
          [vehicle.photo_url, ...(vehicle.photo_urls ?? [])].filter((path): path is string =>
            Boolean(path),
          ),
        ),
      ]
        .map((path) => hirePhotoMap.get(path))
        .filter((url): url is string => Boolean(url)),
    }));
    return {
      activeRides: active ?? [],
      pendingHireVehicles,
      pendingDeliveryRates,
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
        kind: z.enum(["driver", "vehicle", "fleet", "document", "hire_vehicle", "delivery_rate"]),
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

    if (data.kind === "delivery_rate") {
      if (data.decision !== "approved" && data.decision !== "rejected") {
        throw new Error("Delivery rate proposals can only be approved or rejected.");
      }
      const { error } = await supabaseAdmin.rpc("review_delivery_rate_proposal", {
        p_proposal_id: data.id,
        p_decision: data.decision === "approved" ? "approved" : "rejected",
        p_reviewer_id: context.userId,
        ...(data.note ? { p_note: data.note } : {}),
      });
      if (error) throw new Error(error.message);
    } else if (data.kind === "hire_vehicle") {
      const decision =
        data.decision === "approved"
          ? "approved"
          : data.decision === "pending"
            ? "pending"
            : "rejected";
      if (decision === "approved") {
        const { data: listing, error: listingError } = await supabaseAdmin
          .from("vehicles")
          .select("status, hire_daily_rate, photo_url, photo_urls")
          .eq("id", data.id)
          .maybeSingle();
        if (listingError) throw new Error(listingError.message);
        if (!listing) throw new Error("Hire vehicle not found.");
        if (listing.status !== "approved") {
          throw new Error("Approve the vehicle for road use before approving its hire listing.");
        }
        if (!(Number(listing.hire_daily_rate ?? 0) > 0)) {
          throw new Error("The owner must set a daily hire price before approval.");
        }
        if (!listing.photo_url && !(listing.photo_urls ?? []).length) {
          throw new Error("The owner must add at least one hire photo before approval.");
        }
      }
      const { error } = await supabaseAdmin
        .from("vehicles")
        .update({
          hire_approval_status: decision,
          hire_available: decision === "approved",
          hire_reviewed_by: context.userId,
          hire_reviewed_at: new Date().toISOString(),
          hire_rejection_reason: decision === "rejected" ? (data.note ?? "Not accepted") : null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const table = {
        driver: "drivers",
        vehicle: "vehicles",
        fleet: "fleets",
        document: "documents",
      }[data.kind] as "drivers" | "vehicles" | "fleets" | "documents";

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
        const { error } = await supabaseAdmin
          .from(table)
          .update({ status: data.decision })
          .eq("id", data.id);
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
              const { data: driverProfile } = await supabaseAdmin
                .from("drivers")
                .select("id")
                .eq("id", vehicle.owner_driver_id)
                .maybeSingle();
              if (driverProfile) {
                // Only ride drivers receive authorisation to operate the car.
                const { data: existing } = await supabaseAdmin
                  .from("driver_vehicle_authorisations")
                  .select("id")
                  .eq("vehicle_id", data.id)
                  .eq("driver_id", vehicle.owner_driver_id)
                  .is("revoked_at", null)
                  .maybeSingle();
                if (!existing) {
                  await supabaseAdmin.from("driver_vehicle_authorisations").insert({
                    vehicle_id: data.id,
                    driver_id: vehicle.owner_driver_id,
                    granted_by: context.userId,
                  });
                }
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
    }
    if (data.kind === "fleet" && data.decision === "approved") {
      const { data: fleet } = await supabaseAdmin
        .from("fleets")
        .select("owner_id")
        .eq("id", data.id)
        .maybeSingle();
      if (fleet?.owner_id) {
        const { error } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: fleet.owner_id, role: "fleet_owner" }, { onConflict: "user_id,role" });
        if (error) throw new Error(error.message);
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
    await audit(context.userId, `${data.kind}_${data.decision}`, data.kind, data.id, {
      note: data.note ?? null,
    });
    return { ok: true };
  });

/** Ops may pause or republish only a vehicle and hire listing already approved. */
export const setHireListingAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        available: z.boolean(),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: vehicle, error: loadError } = await supabaseAdmin
      .from("vehicles")
      .select("status, hire_approval_status")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!vehicle) throw new Error("Hire vehicle not found.");
    if (
      data.available &&
      (vehicle.status !== "approved" || vehicle.hire_approval_status !== "approved")
    ) {
      throw new Error("Only road-approved vehicles with approved hire listings can be published.");
    }
    const { error } = await supabaseAdmin
      .from("vehicles")
      .update({
        hire_available: data.available,
        hire_reviewed_by: context.userId,
        hire_reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.vehicleId);
    if (error) throw new Error(error.message);
    const { audit } = await import("./notifications.server");
    await audit(
      context.userId,
      data.available ? "hire_vehicle_published" : "hire_vehicle_unlisted",
      "vehicle",
      data.vehicleId,
      { note: data.note ?? null },
    );
    return { ok: true, available: data.available };
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

    const [
      { data: wallets },
      { data: withdrawals },
      { data: refunds },
      { data: entries },
      { data: intents },
    ] = await Promise.all([
      supabaseAdmin.from("wallets").select("*").order("cached_balance"),
      supabaseAdmin
        .from("withdrawals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin.from("refunds").select("*").order("created_at", { ascending: false }).limit(50),
      supabaseAdmin
        .from("wallet_ledger")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("payment_intents")
        .select("id, status, amount, mode, provider, created_at, ride_id")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const ledger = entries ?? [];
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const [{ data: paidIntents }, { data: commissionRows }] = await Promise.all([
      supabaseAdmin
        .from("payment_intents")
        .select("amount, created_at")
        .eq("status", "paid")
        .gte("created_at", since)
        .limit(5000),
      supabaseAdmin
        .from("wallet_ledger")
        .select("amount, created_at")
        .eq("entry_type", "platform_commission")
        .gte("created_at", since)
        .limit(5000),
    ]);
    return {
      periodRows: {
        collected: (paidIntents ?? []).map((r) => ({ amount: Number(r.amount), at: r.created_at })),
        commission: (commissionRows ?? []).map((r) => ({ amount: Math.abs(Number(r.amount)), at: r.created_at })),
      },
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
      .update({
        status: data.decision,
        review_note: data.note ?? null,
        reviewed_by: context.userId,
      })
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
    await audit(context.userId, "wallet_adjusted", "wallet", data.walletId, {
      amount: data.amount,
    });
    return result;
  });

/* ------------------------------ SUPER ADMIN ------------------------------ */

export const getPricingWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      { data: configs },
      { data: policies },
      { data: bands },
      { data: modifiers },
      { data: settings },
    ] = await Promise.all([
      supabaseAdmin
        .from("fare_configs")
        .select("*")
        .order("vehicle_class")
        .order("version", { ascending: false }),
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
        vehicleClass: z.enum(["go", "plus", "comfort", "xl", "boda", "e_boda"]),
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
    const rows =
      issues.length > 0
        ? []
        : previewTable(
            pricing.config,
            policy,
            pricing.modifiers,
            [1, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120],
          );
    return { issues, rows };
  });

/** Saves a new draft policy version. Publishing is a separate, explicit step. */
export const saveDistancePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(3).max(80),
        vehicleClass: z.enum(["go", "plus", "comfort", "xl"]).nullable(),
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
      bands: data.bands.map((b) => ({
        ...b,
        customer_explanation: b.customer_explanation ?? null,
      })),
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
    await audit(context.userId, "distance_policy_drafted", "distance_policy", policy.id, {
      version,
    });
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
        vehicleClass: z.enum(["boda", "e_boda", "go", "plus", "comfort", "xl"]),
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
    await audit(
      context.userId,
      data.publish ? "fare_config_published" : "fare_config_drafted",
      "fare_config",
      created.id,
      {
        version,
      },
    );
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
        ramp_mode: z.enum(["none", "linear"]).optional(),
        peak_percent: z.number().min(0).max(300).nullable().optional(),
        peak_at: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        window_start: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        window_end: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { id, ...rest } = data;
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("pricing_modifiers")
      .update(patch as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "pricing_modifier_updated", "pricing_modifier", id, patch);
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
    const { error } = await supabaseAdmin.from("system_settings").upsert(
      {
        key: data.key,
        value: data.value as never,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    await audit(context.userId, "system_setting_updated", "system_setting", data.key, {
      value: data.value,
    });
    return { ok: true };
  });

export const listStaffUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("*");
    const { data: hireCars } = await supabaseAdmin
      .from("vehicles").select("owner_driver_id, fleet_id").neq("hire_approval_status", "not_submitted");
    const fleetIds = [...new Set((hireCars ?? []).map((v) => v.fleet_id).filter((v): v is string => Boolean(v)))];
    const { data: hireFleets } = fleetIds.length
      ? await supabaseAdmin.from("fleets").select("owner_id").in("id", fleetIds)
      : { data: [] as Array<{ owner_id: string }> };
    const hireOwnerIds = [...new Set([
      ...(hireCars ?? []).map((v) => v.owner_driver_id).filter((v): v is string => Boolean(v)),
      ...(hireFleets ?? []).map((f) => f.owner_id),
    ])];
    const { data: drivers } = await supabaseAdmin.from("drivers").select("id, status");
    const ids = [...new Set([...(roles ?? []).map((r) => r.user_id), ...hireOwnerIds])];
    const { data: profiles } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email, phone").in("id", ids)
      : { data: [] };
    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(60);
    return { roles: roles ?? [], profiles: profiles ?? [], auditLogs: logs ?? [], hireOwnerIds, driverStatus: Object.fromEntries((drivers ?? []).map((d) => [d.id, d.status])) as Record<string, string> };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        role: z.enum([
          "customer",
          "driver",
          "fleet_owner",
          "ops_admin",
          "finance_admin",
          "super_admin",
        ]),
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
        .upsert(
          { user_id: profile.id, role: data.role, granted_by: context.userId },
          { onConflict: "user_id,role" },
        );
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

/* ------------------------------ PROMOTIONS ------------------------------ */

const promoInput = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  discount_percent: z.number().min(0).max(100),
  max_discount_percent: z.number().min(0).max(100),
  max_discount_amount: z.number().min(0).optional().nullable(),
  min_fare: z.number().min(0).optional().nullable(),
  valid_from: z.string().min(1),
  valid_until: z.string().min(1).optional().nullable(),
  usage_limit: z.number().int().positive().optional().nullable(),
  applies_to: z.array(z.enum(["go", "plus", "comfort", "xl", "boda", "e_boda"])).default([]),
  active: z.boolean().default(true),
});

export const listPromotions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = (await supabaseAdmin
      .from("promotions")
      .select("*")
      .order("created_at", { ascending: false })) as { data: unknown[] | null };
    return (data ?? []) as import("./discounts").PromoRow[];
  });

export const savePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => promoInput.parse(input))
  .handler(async ({ data: input, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");

    const payload = {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      discount_percent: input.discount_percent,
      max_discount_percent: input.max_discount_percent,
      max_discount_amount: input.max_discount_amount ?? null,
      min_fare: input.min_fare ?? null,
      valid_from: input.valid_from,
      valid_until: input.valid_until ?? null,
      usage_limit: input.usage_limit ?? null,
      applies_to: input.applies_to,
      active: input.active,
    };

    let promotionId = input.id;
    if (promotionId) {
      const { error } = await supabaseAdmin
        .from("promotions")
        .update(payload)
        .eq("id", promotionId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("promotions")
        .insert({ ...payload, created_by: context.userId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      promotionId = (created as unknown as { id: string }).id;
    }

    await audit(
      context.userId,
      input.id ? "promotion_updated" : "promotion_created",
      "promotion",
      promotionId!,
      {
        code: input.code,
        max_discount_percent: input.max_discount_percent,
      },
    );
    return { id: promotionId };
  });

export const togglePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { error } = await supabaseAdmin
      .from("promotions")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(
      context.userId,
      data.active ? "promotion_activated" : "promotion_deactivated",
      "promotion",
      data.id,
    );
    return { ok: true };
  });

export const deletePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, SUPER } = await import("./authz.server");
    await requireRole(context.userId, SUPER);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { error } = await supabaseAdmin.from("promotions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(context.userId, "promotion_deleted", "promotion", data.id);
    return { ok: true };
  });

/**
 * Customer-facing validation: confirms a code is usable on the given fare and
 * returns the discounted amount. The server applies the configured max caps.
 */
export const validatePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ code: z.string().trim().min(2).max(40), totalFare: z.number().min(0) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { promoState, applyPromo } = await import("./discounts");

    const code = data.code.toUpperCase();
    const { data: rows } = await supabaseAdmin
      .from("promotions")
      .select("*")
      .eq("code", code)
      .limit(1);
    const promo = rows?.[0];
    if (!promo) {
      return {
        valid: false as const,
        state: "invalid" as const,
        message: "That code is not recognised.",
      };
    }

    const state = promoState(promo);
    if (state !== "active") {
      const message =
        state === "expired"
          ? "That code has expired."
          : state === "not_started"
            ? "That code is not live yet."
            : state === "usage_exhausted"
              ? "That code has reached its usage limit."
              : "That code is not currently active.";
      return { valid: false as const, state, message };
    }

    const priced = applyPromo(data.totalFare, promo);
    if (priced.blocked_min_fare) {
      return {
        valid: false as const,
        state: "invalid" as const,
        message: `This code needs a fare of at least KES ${Number(promo.min_fare).toFixed(2)}.`,
      };
    }

    return {
      valid: true as const,
      state: "active" as const,
      promotionId: promo.id,
      code: promo.code,
      name: promo.name,
      discount_percent: priced.discount_percent,
      discount_amount: priced.discount_amount,
      total_before_discount: data.totalFare,
      total_fare: priced.total_fare,
    };
  });

/* ------------------------------ FLEET OWNER ------------------------------ */

export const getFleetBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets } = await supabaseAdmin
      .from("fleets")
      .select("*")
      .eq("owner_id", context.userId);
    const fleetIds = (fleets ?? []).map((f) => f.id);
    if (fleetIds.length === 0)
      return { fleets: [], vehicles: [], drivers: [], wallet: null, entries: [], rides: [] };

    const { data: vehicles } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .in("fleet_id", fleetIds);
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

/** Ride requests that never got a driver (or are still waiting too long). */
export const getUnattendedRides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ days: z.number().int().min(1).max(90).default(7) }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86400000).toISOString();
    const stale = new Date(Date.now() - 2 * 60000).toISOString();
    const { data: rides, error } = await supabaseAdmin
      .from("rides")
      .select("id, reference, status, requested_at, total_fare, payment_method, customer_id, quote_id")
      .gte("requested_at", since)
      .or(`status.in.(no_driver_found,expired),and(status.eq.searching,requested_at.lt.${stale})`)
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const list = rides ?? [];
    const qIds = [...new Set(list.map((r) => r.quote_id).filter(Boolean))];
    const cIds = [...new Set(list.map((r) => r.customer_id))];
    const [{ data: quotes }, { data: people }] = await Promise.all([
      qIds.length
        ? supabaseAdmin.from("route_quotes").select("id, pickup_address, dropoff_address, pickup_lat, pickup_lng").in("id", qIds)
        : Promise.resolve({ data: [] as { id: string; pickup_address: string | null; dropoff_address: string | null; pickup_lat: number; pickup_lng: number }[] }),
      cIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", cIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; phone: string | null }[] }),
    ]);
    const qm = new Map((quotes ?? []).map((q) => [q.id, q]));
    const pm = new Map((people ?? []).map((p) => [p.id, p]));
    return list.map((r) => ({
      ...r,
      pickup: qm.get(r.quote_id)?.pickup_address ?? null,
      dropoff: qm.get(r.quote_id)?.dropoff_address ?? null,
      pickup_lat: qm.get(r.quote_id)?.pickup_lat ?? null,
      pickup_lng: qm.get(r.quote_id)?.pickup_lng ?? null,
      customer_name: pm.get(r.customer_id)?.full_name ?? null,
      customer_phone: pm.get(r.customer_id)?.phone ?? null,
    }));
  });

export const RESOLUTION_STAGES = ["investigating", "driver_assigned", "rebooked", "customer_cancelled", "refund_needed", "refunded", "resolved"] as const;

/** Unattended rides enriched with payment, refund and latest resolution. */
export const getUnattendedResolutions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideIds: z.array(z.string().uuid()).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    if (!data.rideIds.length) return {};
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: rides }, { data: intents }, { data: refunds }, { data: logs }] = await Promise.all([
      supabaseAdmin.from("rides").select("id, payment_status").in("id", data.rideIds),
      supabaseAdmin.from("payment_intents").select("ride_id, amount, provider_reference, status").in("ride_id", data.rideIds).eq("status", "paid"),
      supabaseAdmin.from("refunds").select("ride_id, amount, status").in("ride_id", data.rideIds),
      supabaseAdmin.from("audit_logs").select("entity_id, metadata, created_at").eq("action", "unattended_resolution").in("entity_id", data.rideIds).order("created_at", { ascending: false }),
    ]);
    const out: Record<string, { payment_status: string; paid: number; mpesa: string | null; refund: { amount: number; status: string } | null; history: { stage: string; note: string; at: string }[] }> = {};
    for (const r of rides ?? []) out[r.id] = { payment_status: r.payment_status, paid: 0, mpesa: null, refund: null, history: [] };
    for (const i of intents ?? []) { const o = i.ride_id ? out[i.ride_id] : undefined; if (o) { o.paid += Number(i.amount); o.mpesa = i.provider_reference; } }
    for (const f of refunds ?? []) { const o = out[f.ride_id]; if (o) o.refund = { amount: Number(f.amount), status: f.status }; }
    for (const l of logs ?? []) {
      const m = (l.metadata ?? {}) as { stage?: string; note?: string };
      const o = l.entity_id ? out[l.entity_id] : undefined;
      if (o) o.history.push({ stage: m.stage ?? "", note: m.note ?? "", at: l.created_at });
    }
    return out;
  });

export const resolveUnattendedRide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rideId: z.string().uuid(), stage: z.enum(RESOLUTION_STAGES), note: z.string().trim().max(500).default(""), notifyCustomer: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { data: ride, error } = await supabaseAdmin.from("rides").select("id, reference, customer_id, total_fare, payment_status").eq("id", data.rideId).single();
    if (error || !ride) throw new Error("Ride not found");
    if (data.stage === "refund_needed") {
      if (ride.payment_status !== "paid" && ride.payment_status !== "refund_pending") throw new Error("This ride has no confirmed payment to refund.");
      await supabaseAdmin.from("refunds").upsert(
        { ride_id: ride.id, amount: Number(ride.total_fare), reason: `Unattended request: ${data.note || "no driver"}`, status: "pending", idempotency_key: `refund:${ride.id}` },
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      await supabaseAdmin.from("rides").update({ payment_status: "refund_pending" }).eq("id", ride.id);
    }
    if (data.stage === "refunded") {
      await supabaseAdmin.from("refunds").update({ status: "completed", approved_by: context.userId }).eq("ride_id", ride.id);
      await supabaseAdmin.from("rides").update({ payment_status: "refunded" }).eq("id", ride.id);
    }
    await audit(context.userId, "unattended_resolution", "ride", ride.id, { stage: data.stage, note: data.note });
    if (data.notifyCustomer) {
      const { data: p } = await supabaseAdmin.from("profiles").select("phone").eq("id", ride.customer_id).maybeSingle();
      const msg: Record<string, string> = {
        refund_needed: `Twende: sorry no driver reached you for ride ${ride.reference}. A refund of KES ${Number(ride.total_fare).toLocaleString()} is being processed.`,
        refunded: `Twende: your refund of KES ${Number(ride.total_fare).toLocaleString()} for ride ${ride.reference} has been sent.`,
      };
      const text = msg[data.stage] ?? `Twende: update on ride ${ride.reference}: ${data.note || data.stage.replaceAll("_", " ")}.`;
      if (p?.phone) {
        const { textUserWithLink } = await import("./links.server");
        await textUserWithLink({ userId: ride.customer_id, message: `${text} Details:`, path: `/rides/${ride.id}`,
          eventType: "unattended_resolution", idempotencyKey: `unattended:${ride.id}:${data.stage}:${Date.now()}` });
      }
    }
    return { ok: true };
  });


/** Approved drivers ops can call, nearest first when the pickup is known. */
export const listDriversForManualDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { haversineKm } = await import("./geo");
    const { data: ride } = await supabaseAdmin.from("rides").select("quote_id").eq("id", data.rideId).maybeSingle();
    const { data: quote } = ride?.quote_id
      ? await supabaseAdmin.from("route_quotes").select("pickup_lat, pickup_lng").eq("id", ride.quote_id).maybeSingle()
      : { data: null };
    const { data: drivers } = await supabaseAdmin
      .from("drivers").select("id, is_online, last_lat, last_lng, active_vehicle_id").eq("status", "approved");
    const ids = (drivers ?? []).map((d) => d.id);
    const { data: people } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", ids)
      : { data: [] as Array<{ id: string; full_name: string | null; phone: string | null }> };
    return (drivers ?? []).map((d) => {
      const p = (people ?? []).find((x) => x.id === d.id);
      const km = quote && d.last_lat != null && d.last_lng != null
        ? Number(haversineKm({ lat: quote.pickup_lat, lng: quote.pickup_lng }, { lat: d.last_lat, lng: d.last_lng }).toFixed(1))
        : null;
      return { id: d.id, name: p?.full_name ?? "Driver", phone: p?.phone ?? null, online: d.is_online, has_vehicle: Boolean(d.active_vehicle_id), km };
    }).sort((a, b) => Number(b.online) - Number(a.online) || (a.km ?? 999) - (b.km ?? 999));
  });

/**
 * Ops called a driver: send that driver a direct ride request. The driver accepts
 * in their app like any request, and the customer then sees the normal trip flow.
 */
export const manualDispatchToDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rideId: z.string().uuid(), driverId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ride } = await supabaseAdmin.from("rides").select("id, status, driver_id, customer_id, reference").eq("id", data.rideId).maybeSingle();
    if (!ride) throw new Error("Ride not found.");
    if (ride.driver_id) throw new Error("This ride already has a driver.");
    if (!["searching", "no_driver_found", "expired"].includes(ride.status)) throw new Error("This ride can no longer be assigned.");
    const { data: driver } = await supabaseAdmin.from("drivers").select("id, status, active_vehicle_id").eq("id", data.driverId).maybeSingle();
    if (driver?.status !== "approved") throw new Error("Pick an approved driver.");
    if (!driver.active_vehicle_id) throw new Error("That driver has no active vehicle selected. Ask them to pick one in the app.");
    await supabaseAdmin.from("rides").update({ status: "searching" }).eq("id", ride.id);
    await supabaseAdmin.from("ride_status_events").insert({ ride_id: ride.id, status: "searching", actor_id: context.userId, actor_role: "ops_admin", note: "Ops sent the request to a driver directly" });
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const { error } = await supabaseAdmin.from("driver_offers").upsert({
      ride_id: ride.id, driver_id: driver.id, vehicle_id: driver.active_vehicle_id, status: "offered",
      responded_at: null, expires_at: expiresAt,
    }, { onConflict: "ride_id,driver_id" });
    if (error) throw new Error(error.message);
    const { notify, audit } = await import("./notifications.server");
    await notify({ userId: driver.id, templateCode: "ride_offer", title: "New ride request from Twende ops",
      body: "Ops just called you about this ride. Open the app and accept to see the pickup.", rideId: ride.id, dedupeKey: `manual:${ride.id}:${driver.id}:${Date.now()}` });
    const { textUserWithLink } = await import("./links.server");
    await textUserWithLink({ userId: driver.id, message: `Twende: ride ${ride.reference} is waiting for you. Accept it here:`, path: "/driver",
      eventType: "manual_dispatch", idempotencyKey: `manual:${ride.id}:${driver.id}:${Date.now()}` });
    await audit(context.userId, "unattended_resolution", "ride", ride.id, { stage: "driver_assigned", note: "Request sent to driver after call", driver_id: driver.id });
    return { ok: true, expiresAt };
  });

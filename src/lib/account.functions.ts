import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { formatKenyanPlate } from "@/lib/plate";

/** Everything the shell needs to decide what a signed-in person may see. */
export const getMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }, { data: driver }, { data: fleets }, { data: hireVehicles }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("drivers").select("*").eq("id", userId).maybeSingle(),
        supabase.from("fleets").select("*").eq("owner_id", userId),
        supabase.from("vehicles").select("id").eq("owner_driver_id", userId).limit(1),
      ]);
    const roleList = (roles ?? []).map((r) => r.role);
    return {
      userId,
      profile,
      roles: roleList,
      driver,
      fleets: fleets ?? [],
      hasHireVehicles: Boolean(hireVehicles?.length),
      isStaff: roleList.some((r) => ["ops_admin", "finance_admin", "super_admin"].includes(r)),
    };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        full_name: z.string().min(2).max(120).optional(),
        phone: z.string().min(9).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { normaliseKenyanPhone } = await import("./phone");
    const patch: { full_name?: string; phone?: string } = {};
    if (data.full_name) patch.full_name = data.full_name;
    if (data.phone) patch.phone = normaliseKenyanPhone(data.phone);
    const { error } = await context.supabase
      .from("profiles")
      .update(patch)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Self-service driver application. Approval always stays with operations. */
export const applyAsDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        plate_number: z.string().min(4).max(16),
        vehicle_class: z.enum(["boda", "e_boda", "go", "plus", "comfort", "xl"]),
        make: z.string().max(40).optional(),
        model: z.string().max(40).optional(),
        colour: z.string().max(24).optional(),
        year: z.number().int().min(1980).max(2100).optional(),
        agreement_version: z.string().min(1).max(40),
        agreement_signer_name: z.string().trim().min(2).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { DRIVER_AGREEMENT_VERSION } = await import("./driver-agreement");
    const userId = context.userId;

    if (data.agreement_version !== DRIVER_AGREEMENT_VERSION) {
      throw new Error("Please read and accept the latest Driver Partner Agreement.");
    }
    const { error: agreementError } = await supabaseAdmin.from("driver_agreement_acceptances").upsert(
      {
        user_id: userId,
        agreement_version: data.agreement_version,
        signer_name: data.agreement_signer_name,
        user_agent: getRequestHeader("user-agent")?.slice(0, 300) ?? null,
        ip: (getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? "").slice(0, 80) || null,
      },
      { onConflict: "user_id,agreement_version", ignoreDuplicates: true },
    );
    if (agreementError) throw new Error(agreementError.message);

    const { data: existingDriver, error: existingDriverError } = await supabaseAdmin
      .from("drivers")
      .select("id, status, active_vehicle_id")
      .eq("id", userId)
      .maybeSingle();
    if (existingDriverError) throw new Error(existingDriverError.message);
    if (existingDriver?.status !== "approved") {
      const { error: driverUpsertError } = await supabaseAdmin
        .from("drivers")
        .upsert({ id: userId, status: "pending" }, { onConflict: "id" });
      if (driverUpsertError) throw new Error(driverUpsertError.message);
    }
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "driver" }, { onConflict: "user_id,role" });

    const { data: vehicle, error } = await supabaseAdmin
      .from("vehicles")
      .insert({
        plate_number: formatKenyanPlate(data.plate_number),
        vehicle_class: data.vehicle_class,
        make: data.make ?? null,
        model: data.model ?? null,
        colour: data.colour ?? null,
        year: data.year ?? null,
        owner_driver_id: userId,
        status: "pending",
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("That number plate is already registered.");
      throw new Error(error.message);
    }
    if (
      !existingDriver ||
      (existingDriver.status !== "approved" && !existingDriver.active_vehicle_id)
    ) {
      const { error: activeVehicleError } = await supabaseAdmin
        .from("drivers")
        .update({ active_vehicle_id: vehicle.id })
        .eq("id", userId);
      if (activeVehicleError) throw new Error(activeVehicleError.message);
    }
    // Authorise the owner to drive their own vehicle. It only takes effect once
    // operations approve the vehicle.
    await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .insert({ vehicle_id: vehicle.id, driver_id: userId });
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.phone) {
      await supabaseAdmin
        .from("partner_interest_requests")
        .update({ status: "closed", reviewed_at: new Date().toISOString() })
        .eq("phone", profile.phone)
        .eq("request_type", "driver")
        .eq("status", "approved");
    }
    await audit(userId, "driver_application_submitted", "driver", userId, { vehicle: vehicle.id });
    await (await import("./links.server")).alertStaffVehicleSubmitted(vehicle.id, "ride");
    return { vehicle };
  });

/** Existing drivers can add another vehicle without resetting their driver approval. */
export const addVehicleForDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        plate_number: z.string().min(4).max(16),
        vehicle_class: z.enum(["boda", "e_boda", "go", "plus", "comfort", "xl"]),
        make: z.string().max(40).optional(),
        model: z.string().max(40).optional(),
        colour: z.string().max(24).optional(),
        year: z.number().int().min(1980).max(2100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!driver) throw new Error("Complete driver onboarding before adding another vehicle.");
    const plate = formatKenyanPlate(data.plate_number);
    const { data: duplicate } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .eq("plate_number", plate)
      .maybeSingle();
    if (duplicate) throw new Error("That number plate is already registered.");
    const { data: vehicle, error } = await supabaseAdmin
      .from("vehicles")
      .insert({
        plate_number: plate,
        vehicle_class: data.vehicle_class,
        make: data.make ?? null,
        model: data.model ?? null,
        colour: data.colour ?? null,
        year: data.year ?? null,
        owner_driver_id: context.userId,
        status: "pending",
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("That number plate is already registered.");
      throw new Error(error.message);
    }
    await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .insert({ vehicle_id: vehicle.id, driver_id: context.userId });
    await (await import("./links.server")).alertStaffVehicleSubmitted(vehicle.id, "ride");
    return { vehicle };
  });

/** Signed-in users may submit a vehicle for hire without applying to drive rides. */
export const addVehicleForHire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        plate_number: z.string().min(4).max(16),
        vehicle_class: z.enum(["boda", "e_boda", "go", "plus", "comfort", "xl"]),
        make: z.string().max(40).optional(),
        model: z.string().max(40).optional(),
        colour: z.string().max(24).optional(),
        year: z.number().int().min(1980).max(2100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const plate = formatKenyanPlate(data.plate_number);
    const { data: duplicate } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .eq("plate_number", plate)
      .maybeSingle();
    if (duplicate) throw new Error("That number plate is already registered.");

    const { data: vehicle, error } = await supabaseAdmin
      .from("vehicles")
      .insert({
        plate_number: plate,
        vehicle_class: data.vehicle_class,
        make: data.make ?? null,
        model: data.model ?? null,
        colour: data.colour ?? null,
        year: data.year ?? null,
        owner_driver_id: context.userId,
        status: "pending",
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("That number plate is already registered.");
      throw new Error(error.message);
    }
    await (await import("./links.server")).alertStaffVehicleSubmitted(vehicle.id, "hire");
    return { vehicle };
  });

export const listNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("notification_outbox")
      .select("*")
      .eq("user_id", context.userId)
      .eq("channel", "in_app")
      .order("created_at", { ascending: false })
      .limit(40);
    return data ?? [];
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("notification_outbox")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("read_at", null);
    return { ok: true };
  });

export const getNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data }, { data: profile }] = await Promise.all([
      context.supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase.from("profiles").select("phone").eq("id", context.userId).maybeSingle(),
    ]);
    return data
      ? { ...data, phone: profile?.phone ?? null }
      : {
          user_id: context.userId,
          sms_enabled: true,
          email_enabled: true,
          whatsapp_enabled: true,
          whatsapp_opted_in_at: null,
          push_enabled: false,
          push_permission: "default",
          updated_at: new Date().toISOString(),
          phone: profile?.phone ?? null,
        };
  });

export const updateNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        sms_enabled: z.boolean().optional(),
        email_enabled: z.boolean().optional(),
        whatsapp_enabled: z.boolean().optional(),
        push_enabled: z.boolean().optional(),
        push_permission: z.enum(["default", "granted", "denied"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.whatsapp_enabled === true) {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("phone")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile?.phone)
        throw new Error("Add a mobile number to your profile before opting in to WhatsApp.");
    }
    const { error } = await context.supabase.from("notification_preferences").upsert(
      {
        user_id: context.userId,
        ...(data.sms_enabled === undefined ? {} : { sms_enabled: data.sms_enabled }),
        ...(data.email_enabled === undefined ? {} : { email_enabled: data.email_enabled }),
        ...(data.whatsapp_enabled === undefined
          ? {}
          : {
              whatsapp_enabled: data.whatsapp_enabled,
              whatsapp_opted_in_at: data.whatsapp_enabled ? new Date().toISOString() : null,
              whatsapp_opt_in_source: data.whatsapp_enabled ? "account_settings" : null,
            }),
        ...(data.push_enabled === undefined ? {} : { push_enabled: data.push_enabled }),
        ...(data.push_permission === undefined ? {} : { push_permission: data.push_permission }),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reportIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rideId: z.string().uuid().optional().nullable(),
        category: z.enum([
          "safety",
          "fare",
          "driver_conduct",
          "customer_conduct",
          "vehicle",
          "other",
        ]),
        description: z.string().min(10).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("incidents").insert({
      reporter_id: context.userId,
      ride_id: data.rideId ?? null,
      category: data.category,
      description: data.description,
      status: "open",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Everything the driver onboarding wizard needs: application state + document checklist. */
export const getDriverOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [
      { data: driver },
      { data: ownedVehicles },
      { data: types },
      { data: documents },
      { data: profile },
    ] = await Promise.all([
      supabase.from("drivers").select("*").eq("id", userId).maybeSingle(),
      supabase.from("vehicles").select("*").eq("owner_driver_id", userId),
      supabase.from("document_types").select("*").eq("active", true).order("label"),
      supabase.from("documents").select("*").eq("subject_user_id", userId),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authorisations, error: authorisationError } = await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .select("vehicle_id")
      .eq("driver_id", userId)
      .is("revoked_at", null);
    if (authorisationError) throw new Error(authorisationError.message);
    const ownedVehicleIds = new Set((ownedVehicles ?? []).map((vehicle) => vehicle.id));
    const additionalVehicleIds = [
      ...new Set((authorisations ?? []).map((row) => row.vehicle_id)),
    ].filter((id) => !ownedVehicleIds.has(id));
    let authorisedVehicles: NonNullable<typeof ownedVehicles> = [];
    if (additionalVehicleIds.length) {
      const { data, error } = await supabaseAdmin
        .from("vehicles")
        .select("*")
        .in("id", additionalVehicleIds);
      if (error) throw new Error(error.message);
      authorisedVehicles = data ?? [];
    }
    return {
      driver,
      profile,
      vehicles: [...(ownedVehicles ?? []), ...authorisedVehicles],
      documentTypes: (types ?? []).filter(
        (t) => t.applies_to === "driver" || t.applies_to === "owner" || t.applies_to === "vehicle",
      ),
      documents: documents ?? [],
    };
  });

/** Driver-submitted document record. Approval always stays with operations. */
export const submitDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        documentTypeId: z.string().uuid(),
        reference: z.string().trim().min(3).max(80),
        issuedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((value) => {
            const parsed = new Date(`${value}T00:00:00.000Z`);
            return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
          }, "Enter a valid issue date.")
          .optional(),
        expiresOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((value) => {
            const parsed = new Date(`${value}T00:00:00.000Z`);
            return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
          }, "Enter a valid expiry date.")
          .optional(),
        vehicleId: z.string().uuid().optional(),
        filePath: z.string().max(300).optional(),
        insuranceProvider: z.string().trim().min(2).max(120).optional(),
        insurancePolicyNumber: z.string().trim().min(3).max(100).optional(),
        insuranceCoverType: z
          .enum([
            "third_party_only",
            "third_party_fire_theft",
            "comprehensive",
            "psv_commercial",
            "other",
          ])
          .optional(),
        insuranceCoverageDetails: z.string().trim().min(3).max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: type } = await context.supabase
      .from("document_types")
      .select("code, label, requires_image, active, applies_to, expires")
      .eq("id", data.documentTypeId)
      .maybeSingle();
    if (!type?.active || !["driver", "owner", "vehicle"].includes(type.applies_to)) {
      throw new Error("That compliance document type is not available for driver submission.");
    }
    if (type?.requires_image && !data.filePath) {
      throw new Error(`Attach a clear photo or scan of your ${type.label.toLowerCase()}.`);
    }
    if (type.expires && !data.expiresOn) {
      throw new Error(`Enter the expiry date for your ${type.label.toLowerCase()}.`);
    }
    if (type.applies_to === "vehicle" && !data.vehicleId) {
      throw new Error("Choose which vehicle this document belongs to.");
    }
    if (type.applies_to !== "vehicle" && data.vehicleId) {
      throw new Error("This document belongs to your profile, not a vehicle.");
    }
    const isVehicleInsurance = type.code === "vehicle_insurance";
    if (isVehicleInsurance) {
      if (type.applies_to !== "vehicle" || !data.vehicleId)
        throw new Error("Choose the vehicle this insurance policy covers.");
      if (
        !data.insuranceProvider ||
        !data.insurancePolicyNumber ||
        !data.insuranceCoverType ||
        !data.insuranceCoverageDetails
      )
        throw new Error("Enter the insurance provider, policy number, cover type, and coverage details.");
    } else if (
      data.insuranceProvider !== undefined ||
      data.insurancePolicyNumber !== undefined ||
      data.insuranceCoverType !== undefined ||
      data.insuranceCoverageDetails !== undefined
    ) {
      throw new Error("Insurance details can only be attached to a vehicle insurance document.");
    }
    // A driver may only reference a file inside their own folder.
    if (data.filePath && !data.filePath.startsWith(`${context.userId}/`)) {
      throw new Error("That upload does not belong to your account.");
    }
    if (data.vehicleId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: owned }, { data: authorised }] = await Promise.all([
        supabaseAdmin
          .from("vehicles")
          .select("id")
          .eq("id", data.vehicleId)
          .eq("owner_driver_id", context.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("driver_vehicle_authorisations")
          .select("vehicle_id")
          .eq("vehicle_id", data.vehicleId)
          .eq("driver_id", context.userId)
          .is("revoked_at", null)
          .maybeSingle(),
      ]);
      if (!owned && !authorised)
        throw new Error(
          "You can only attach a vehicle document to a vehicle you own or are authorised to drive.",
        );
    }
    const { error } = await context.supabase.from("documents").insert({
      document_type_id: data.documentTypeId,
      subject_user_id: context.userId,
      subject_vehicle_id: data.vehicleId ?? null,
      reference: data.reference,
      insurance_provider: data.insuranceProvider ?? null,
      insurance_policy_number: data.insurancePolicyNumber ?? null,
      insurance_cover_type: data.insuranceCoverType ?? null,
      insurance_coverage_details: data.insuranceCoverageDetails ?? null,
      issued_on: data.issuedOn || null,
      expires_on: data.expiresOn || null,
      file_path: data.filePath ?? null,
      status: "pending",
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Stores the driver's profile photo. The file already sits in the driver's own
 * folder in the private documents bucket; the rider only ever sees a short-lived
 * signed link generated when they are matched with this driver.
 */
export const saveDriverPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ filePath: z.string().min(3).max(300) }).parse(input))
  .handler(async ({ data, context }) => {
    if (!data.filePath.startsWith(`${context.userId}/`)) {
      throw new Error("That upload does not belong to your account.");
    }
    const { error } = await context.supabase
      .from("profiles")
      .update({ avatar_url: data.filePath })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** A short-lived link to the signed-in driver's own photo, for previewing it. */
export const getMyPhotoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.avatar_url) return { url: null as string | null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage
      .from("driver-documents")
      .createSignedUrl(profile.avatar_url, 3600);
    return { url: signed?.signedUrl ?? null };
  });

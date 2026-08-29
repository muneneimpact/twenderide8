import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { formatKenyanPlate } from "@/lib/plate";

/** Everything the shell needs to decide what a signed-in person may see. */
export const getMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }, { data: driver }, { data: fleets }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("drivers").select("*").eq("id", userId).maybeSingle(),
      supabase.from("fleets").select("*").eq("owner_id", userId),
    ]);
    const roleList = (roles ?? []).map((r) => r.role);
    return {
      userId,
      profile,
      roles: roleList,
      driver,
      fleets: fleets ?? [],
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
    const { error } = await context.supabase.from("profiles").update(patch).eq("id", context.userId);
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
        vehicle_class: z.enum(["boda", "economy", "comfort", "xl"]),
        make: z.string().max(40).optional(),
        model: z.string().max(40).optional(),
        colour: z.string().max(24).optional(),
        year: z.number().int().min(1980).max(2100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { audit } = await import("./notifications.server");
    const userId = context.userId;

    await supabaseAdmin.from("drivers").upsert({ id: userId, status: "pending" }, { onConflict: "id" });
    await supabaseAdmin.from("user_roles").upsert({ user_id: userId, role: "driver" }, { onConflict: "user_id,role" });

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
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("drivers").update({ active_vehicle_id: vehicle.id }).eq("id", userId);
    // Authorise the owner to drive their own vehicle. It only takes effect once
    // operations approve the vehicle.
    await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .insert({ vehicle_id: vehicle.id, driver_id: userId });
    await audit(userId, "driver_application_submitted", "driver", userId, { vehicle: vehicle.id });
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
    const { data } = await context.supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    return (
      data ?? {
        user_id: context.userId,
        sms_enabled: true,
        email_enabled: true,
        push_enabled: false,
        push_permission: "default",
        updated_at: new Date().toISOString(),
      }
    );
  });

export const updateNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        sms_enabled: z.boolean().optional(),
        email_enabled: z.boolean().optional(),
        push_enabled: z.boolean().optional(),
        push_permission: z.enum(["default", "granted", "denied"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: context.userId,
          ...(data.sms_enabled === undefined ? {} : { sms_enabled: data.sms_enabled }),
          ...(data.email_enabled === undefined ? {} : { email_enabled: data.email_enabled }),
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
        category: z.enum(["safety", "fare", "driver_conduct", "customer_conduct", "vehicle", "other"]),
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
    const [{ data: driver }, { data: vehicles }, { data: types }, { data: documents }, { data: profile }] =
      await Promise.all([
        supabase.from("drivers").select("*").eq("id", userId).maybeSingle(),
        supabase.from("vehicles").select("*").eq("owner_driver_id", userId),
        supabase.from("document_types").select("*").eq("active", true).order("label"),
        supabase.from("documents").select("*").eq("subject_user_id", userId),
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      ]);
    return {
      driver,
      profile,
      vehicles: vehicles ?? [],
      documentTypes: (types ?? []).filter((t) => t.applies_to === "driver" || t.applies_to === "vehicle"),
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
        issuedOn: z.string().max(10).optional(),
        expiresOn: z.string().max(10).optional(),
        vehicleId: z.string().uuid().optional(),
        filePath: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: type } = await context.supabase
      .from("document_types")
      .select("label, requires_image")
      .eq("id", data.documentTypeId)
      .maybeSingle();
    if (type?.requires_image && !data.filePath) {
      throw new Error(`Attach a clear photo or scan of your ${type.label.toLowerCase()}.`);
    }
    // A driver may only reference a file inside their own folder.
    if (data.filePath && !data.filePath.startsWith(`${context.userId}/`)) {
      throw new Error("That upload does not belong to your account.");
    }
    const { error } = await context.supabase.from("documents").insert({
      document_type_id: data.documentTypeId,
      subject_user_id: context.userId,
      subject_vehicle_id: data.vehicleId ?? null,
      reference: data.reference,
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

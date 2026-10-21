import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

async function signDocs(paths: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!paths.length) return new Map<string, string>();
  const { data } = await supabaseAdmin.storage.from("driver-documents").createSignedUrls(paths, 1800);
  return new Map((data ?? []).map((row) => [row.path ?? "", row.signedUrl]));
}

/** Staff view of one driver or vehicle with every credential on file. */
export const getAdminSubjectDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ kind: z.enum(["driver", "vehicle"]), id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, STAFF } = await import("./authz.server");
    await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: types } = await supabaseAdmin
      .from("document_types")
      .select("id, label, applies_to, required, expires");

    let vehicles: VehicleRow[] = [];
    let driverIds: string[] = [];
    if (data.kind === "vehicle") {
      const { data: v } = await supabaseAdmin.from("vehicles").select("*").eq("id", data.id).maybeSingle();
      if (!v) throw new Error("Vehicle not found");
      vehicles = [v];
      const { data: auths } = await supabaseAdmin
        .from("driver_vehicle_authorisations")
        .select("driver_id")
        .eq("vehicle_id", v.id)
        .is("revoked_at", null);
      driverIds = [...new Set([v.owner_driver_id, ...(auths ?? []).map((a) => a.driver_id)].filter(Boolean) as string[])];
    } else {
      driverIds = [data.id];
      const { data: auths } = await supabaseAdmin
        .from("driver_vehicle_authorisations")
        .select("vehicle_id")
        .eq("driver_id", data.id)
        .is("revoked_at", null);
      const ids = (auths ?? []).map((a) => a.vehicle_id);
      const { data: v } = await supabaseAdmin
        .from("vehicles")
        .select("*")
        .or(`owner_driver_id.eq.${data.id}${ids.length ? `,id.in.(${ids.join(",")})` : ""}`);
      vehicles = v ?? [];
    }

    const vehicleIds = vehicles.map((v) => v.id);
    const [{ data: people }, { data: drivers }, { data: docs }] = await Promise.all([
      driverIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email, phone").in("id", driverIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null; phone: string | null }[] }),
      driverIds.length
        ? supabaseAdmin.from("drivers").select("id, status, is_online, rating, completed_rides, created_at").in("id", driverIds)
        : Promise.resolve({ data: [] as { id: string; status: string; is_online: boolean; rating: number; completed_rides: number; created_at: string }[] }),
      supabaseAdmin
        .from("documents")
        .select("id, document_type_id, subject_user_id, subject_vehicle_id, file_path, reference, expires_on, status, rejection_reason, created_at")
        .or(
          [
            driverIds.length ? `subject_user_id.in.(${driverIds.join(",")})` : null,
            vehicleIds.length ? `subject_vehicle_id.in.(${vehicleIds.join(",")})` : null,
          ]
            .filter(Boolean)
            .join(",") || "id.is.null",
        )
        .order("created_at", { ascending: false }),
    ]);
    const urls = await signDocs((docs ?? []).map((d) => d.file_path).filter(Boolean) as string[]);
    const typeLabel = new Map((types ?? []).map((t) => [t.id, t.label]));
    return {
      people: (people ?? []).map((p) => ({ ...p, driver: (drivers ?? []).find((d) => d.id === p.id) ?? null })),
      vehicles,
      documents: (docs ?? []).map((d) => ({
        ...d,
        label: typeLabel.get(d.document_type_id) ?? "Document",
        url: d.file_path ? urls.get(d.file_path) ?? null : null,
      })),
    };
  });

/** Vehicles the caller owns, with drivers they've assigned and what each has handled. */
export const getMyVehicleTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets } = await supabaseAdmin.from("fleets").select("id").eq("owner_id", context.userId);
    const fleetIds = (fleets ?? []).map((f) => f.id);
    const { data: vehicles } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate_number, vehicle_class, make, model, colour, status")
      .or(`owner_driver_id.eq.${context.userId}${fleetIds.length ? `,fleet_id.in.(${fleetIds.join(",")})` : ""}`);
    const vehicleIds = (vehicles ?? []).map((v) => v.id);
    if (!vehicleIds.length) return { vehicles: [], assignments: [] };
    const { data: auths } = await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .select("id, vehicle_id, driver_id, created_at")
      .in("vehicle_id", vehicleIds)
      .is("revoked_at", null)
      .neq("driver_id", context.userId);
    const driverIds = [...new Set((auths ?? []).map((a) => a.driver_id))];
    const [{ data: people }, { data: rides }] = await Promise.all([
      driverIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", driverIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; phone: string | null }[] }),
      driverIds.length
        ? supabaseAdmin
            .from("rides")
            .select("id, reference, driver_id, vehicle_id, status, total_fare, payment_method, completed_at, requested_at")
            .in("vehicle_id", vehicleIds)
            .in("driver_id", driverIds)
            .order("requested_at", { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const assignments = (auths ?? []).map((a) => {
      const mine = (rides ?? []).filter((r) => r.driver_id === a.driver_id && r.vehicle_id === a.vehicle_id);
      const done = mine.filter((r) => r.status === "trip_completed");
      const person = (people ?? []).find((p) => p.id === a.driver_id);
      return {
        ...a,
        name: person?.full_name ?? "Driver",
        phone: person?.phone ?? null,
        completed: done.length,
        cancelled: mine.filter((r) => r.status.startsWith("cancelled_by_driver")).length,
        earned: Number(done.reduce((s, r) => s + Number(r.total_fare ?? 0), 0).toFixed(2)),
        cash: Number(done.filter((r) => r.payment_method === "cash").reduce((s, r) => s + Number(r.total_fare ?? 0), 0).toFixed(2)),
        recent: mine.slice(0, 5).map((r) => ({ id: r.id, reference: r.reference, status: r.status, total_fare: r.total_fare, requested_at: r.requested_at })),
      };
    });
    return { vehicles: vehicles ?? [], assignments };
  });

async function assertOwner(userId: string, vehicleId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: v } = await supabaseAdmin.from("vehicles").select("id, owner_driver_id, fleet_id").eq("id", vehicleId).maybeSingle();
  if (!v) throw new Error("Vehicle not found");
  if (v.owner_driver_id === userId) return;
  if (v.fleet_id) {
    const { data: f } = await supabaseAdmin.from("fleets").select("owner_id").eq("id", v.fleet_id).maybeSingle();
    if (f?.owner_id === userId) return;
  }
  throw new Error("Only the vehicle owner can assign drivers.");
}

/** Owner gives an approved driver (found by phone) permission to drive a vehicle. */
export const assignDriverToVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ vehicleId: z.string().uuid(), phone: z.string().min(9).max(16) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.vehicleId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const phone = normaliseKenyanPhone(data.phone);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .in("phone", [phone, data.phone.trim()].filter(Boolean) as string[])
      .maybeSingle();
    if (!profile) throw new Error("No Twende account found with that phone number.");
    const { data: driver } = await supabaseAdmin.from("drivers").select("id, status").eq("id", profile.id).maybeSingle();
    if (!driver) throw new Error("That person hasn't applied as a driver yet.");
    const { data: existing } = await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .select("id")
      .eq("vehicle_id", data.vehicleId)
      .eq("driver_id", profile.id)
      .is("revoked_at", null)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabaseAdmin
        .from("driver_vehicle_authorisations")
        .insert({ vehicle_id: data.vehicleId, driver_id: profile.id, granted_by: context.userId });
      if (error) throw new Error(error.message);
    }
    return { ok: true, driverApproved: driver.status === "approved" };
  });

export const revokeDriverFromVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ assignmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .select("vehicle_id")
      .eq("id", data.assignmentId)
      .maybeSingle();
    if (!row) throw new Error("Assignment not found");
    await assertOwner(context.userId, row.vehicle_id);
    await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.assignmentId);
    return { ok: true };
  });

/**
 * Owner onboards a new driver by name + phone and assigns them one vehicle.
 * Creates a phone-login account if none exists; the driver stays "pending"
 * until operations approve their ID, driving licence and PSV licence.
 */
export const onboardDriverForVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        fullName: z.string().trim().min(2).max(80),
        phone: z.string().min(9).max(16),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.userId, data.vehicleId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const phone = normaliseKenyanPhone(data.phone);
    let { data: profile } = await supabaseAdmin.from("profiles").select("id").eq("phone", phone).maybeSingle();
    let created = false;
    if (!profile) {
      const password = crypto.randomUUID() + "Aa1!";
      const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
        email: `${phone.replace(/\D/g, "")}@phone.twenderides.app`,
        password,
        email_confirm: true,
        phone,
        phone_confirm: true,
        user_metadata: { full_name: data.fullName, phone },
      });
      if (error || !u.user) throw new Error(error?.message ?? "Could not create the driver account.");
      await supabaseAdmin.from("profiles").upsert({ id: u.user.id, phone, full_name: data.fullName }, { onConflict: "id" });
      profile = { id: u.user.id };
      created = true;
    }
    if (profile.id === context.userId) throw new Error("Use a different phone number from your own.");
    await supabaseAdmin.from("drivers").upsert({ id: profile.id }, { onConflict: "id", ignoreDuplicates: true });
    await supabaseAdmin.from("user_roles").upsert({ user_id: profile.id, role: "driver" }, { onConflict: "user_id,role", ignoreDuplicates: true });
    const { data: existing } = await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .select("id")
      .eq("vehicle_id", data.vehicleId)
      .eq("driver_id", profile.id)
      .is("revoked_at", null)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabaseAdmin
        .from("driver_vehicle_authorisations")
        .insert({ vehicle_id: data.vehicleId, driver_id: profile.id, granted_by: context.userId });
      if (error) throw new Error(error.message);
    }
    try {
      const { sendTransactionalSms } = await import("./sms.server");
      const { appLink } = await import("./links.server");
      await sendTransactionalSms({
        to: phone,
        message: `Twende: you've been added as a driver. Sign in with this number ${phone} and upload your ID, driving licence and PSV licence: ${appLink("/driver/apply")}`,
        eventType: "driver_onboarded",
        userId: profile.id,
      } as never);
    } catch (e) {
      console.error("onboard sms failed", e);
    }
    return { ok: true, created };
  });

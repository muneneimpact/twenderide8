/** Server-only helpers: every SMS carries a one-tap link to the screen where the person acts. */
export const APP_URL = "https://twenderide8.lovable.app";

export function appLink(path: string): string {
  return `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Text a user (by account) with a message ending in an action link. Never throws. */
export async function textUserWithLink(input: {
  userId: string;
  message: string;
  path: string;
  eventType: string;
  idempotencyKey: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin.from("profiles").select("phone").eq("id", input.userId).maybeSingle();
    if (!p?.phone) return;
    const { sendTransactionalSms } = await import("./comms.server");
    await sendTransactionalSms({
      to: p.phone,
      message: `${input.message} ${appLink(input.path)}`,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      context: { userId: input.userId },
    });
  } catch (e) {
    console.error("textUserWithLink failed", e);
  }
}

/** Notify a driver with the onboarding link over SMS and WhatsApp. */
export async function notifyDriverOnboarding(input: {
  userId: string;
  message: string;
  eventType: string;
  idempotencyKey: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone, full_name")
      .eq("id", input.userId)
      .maybeSingle();
    if (!profile?.phone) return;

    const driverDetails = new URLSearchParams({
      fullName: profile.full_name ?? "",
      phone: profile.phone,
    });
    const onboardingDestination = `/driver/apply?${driverDetails.toString()}`;
    const path = `/auth?${new URLSearchParams({
      redirect: onboardingDestination,
      mode: "signup",
      fullName: profile.full_name ?? "",
      phone: profile.phone,
    }).toString()}`;
    const message = `${input.message} ${appLink(path)}`;
    const { sendTransactionalSms } = await import("./comms.server");
    const { whatsappGatewayConfigured, whatsappGatewaySend } = await import("./whatsapp-gateway.server");
    const deliveries: Promise<unknown>[] = [
      sendTransactionalSms({
        to: profile.phone,
        message,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        context: { userId: input.userId },
      }),
    ];
    if (whatsappGatewayConfigured()) {
      deliveries.push(
        whatsappGatewaySend({
          to: profile.phone.replace(/^\+/, ""),
          type: "text",
          text: { body: message },
        }),
      );
    }
    const results = await Promise.allSettled(deliveries);
    results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .forEach((result) => console.error("driver approval channel failed", result.reason));
  } catch (error) {
    console.error("driver approval notification failed", error);
  }
}

export async function notifyDriverApproved(userId: string): Promise<void> {
  return notifyDriverOnboarding({
    userId,
    message: "Twende: your driver application is approved. Complete onboarding here:",
    eventType: "driver_approved_onboarding",
    idempotencyKey: `driver-approved-onboarding:${userId}`,
  });
}

/** Text every staff member holding one of the given roles. */
export async function textStaffWithLink(
  roles: Array<"ops_admin" | "finance_admin" | "super_admin">,
  input: { message: string; path: string; eventType: string; idempotencyKey: string },
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("user_id").in("role", roles);
  const ids = [...new Set((data ?? []).map((r) => r.user_id))];
  await Promise.all(
    ids.map((id) => textUserWithLink({ ...input, userId: id, idempotencyKey: `${input.idempotencyKey}:${id}` })),
  );
}

/** Alert ops, finance and super admins (SMS + WhatsApp when configured) that a vehicle awaits approval. Never throws. */
export async function alertStaffVehicleSubmitted(vehicleId: string, kind: "ride" | "hire"): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("plate_number, make, model, vehicle_class")
      .eq("id", vehicleId)
      .maybeSingle();
    if (!v) return;
    const path = kind === "hire" ? "/admin/hire" : "/admin";
    const label = [v.make, v.model].filter(Boolean).join(" ");
    const msg = `Twende: vehicle ${v.plate_number}${label ? ` (${label})` : ""} was sent for ${kind === "hire" ? "car hire" : "ride"} approval. Review:`;
    const roles = ["ops_admin", "finance_admin", "super_admin"] as const;
    const key = `vehicle-submitted:${kind}:${vehicleId}:${Date.now()}`;
    await textStaffWithLink([...roles], { message: msg, path, eventType: "vehicle_submitted", idempotencyKey: key });
    const { whatsappGatewayConfigured, whatsappGatewaySend } = await import("./whatsapp-gateway.server");
    if (!whatsappGatewayConfigured()) return;
    const { data: staff } = await supabaseAdmin.from("user_roles").select("user_id").in("role", [...roles]);
    const ids = [...new Set((staff ?? []).map((s) => s.user_id))];
    if (!ids.length) return;
    const { data: profs } = await supabaseAdmin.from("profiles").select("phone").in("id", ids);
    await Promise.allSettled(
      (profs ?? []).filter((p) => p.phone).map((p) =>
        whatsappGatewaySend({ to: p.phone!.replace(/^\+/, ""), type: "text", text: { body: `${msg} ${appLink(path)}` } }),
      ),
    );
  } catch (e) {
    console.error("vehicle submitted alert failed", e);
  }
}

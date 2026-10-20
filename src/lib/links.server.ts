/** Server-only helpers: every SMS carries a one-tap link to the screen where the person acts. */
export const APP_URL = "https://twenderides.lovable.app";

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

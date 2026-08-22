import { createFileRoute } from "@tanstack/react-router";

const EMAIL = "munenebonie@tukuzeafrika.org";
const PASSWORD = "159014491";

/** One-off seeding route. Refuses to run once a super admin exists. */
export const Route = createFileRoute("/api/public/bootstrap-super-admin")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: existing } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .eq("role", "super_admin")
          .limit(1);
        if (existing && existing.length > 0) {
          return Response.json({ ok: false, reason: "super_admin_exists" }, { status: 409 });
        }

        let userId: string | null = null;
        const created = await supabaseAdmin.auth.admin.createUser({
          email: EMAIL,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: "Bonie Munene" },
        });
        if (created.data.user) {
          userId = created.data.user.id;
        } else {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("email", EMAIL)
            .maybeSingle();
          userId = profile?.id ?? null;
          if (!userId) {
            return Response.json({ ok: false, error: created.error?.message ?? "unknown" }, { status: 400 });
          }
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: PASSWORD,
            email_confirm: true,
          });
        }

        await supabaseAdmin
          .from("profiles")
          .upsert({ id: userId, email: EMAIL, full_name: "Bonie Munene" }, { onConflict: "id" });
        for (const role of ["super_admin", "ops_admin", "finance_admin"] as const) {
          await supabaseAdmin
            .from("user_roles")
            .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
        }
        return Response.json({ ok: true, userId });
      },
    },
  },
});

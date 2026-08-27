import { createFileRoute } from "@tanstack/react-router";

/**
 * One-off bootstrap for the founding super admin.
 *
 * It refuses to do anything once a super admin already exists, so it cannot be
 * used to mint extra platform owners after the platform is live.
 */
const SUPER_ADMIN_EMAIL = "munene@tukuzeafrika.org";
const SUPER_ADMIN_PASSWORD = "159014491";

export const Route = createFileRoute("/api/public/bootstrap-super-admin")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { count, error: countError } = await supabaseAdmin
          .from("user_roles")
          .select("id", { count: "exact", head: true })
          .eq("role", "super_admin");
        if (countError) return Response.json({ error: countError.message }, { status: 500 });
        if ((count ?? 0) > 0) {
          return Response.json({ status: "already-bootstrapped" }, { status: 409 });
        }

        // Find or create the account.
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        let userId = list?.users.find(
          (user) => user.email?.toLowerCase() === SUPER_ADMIN_EMAIL,
        )?.id;

        if (!userId) {
          const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: SUPER_ADMIN_EMAIL,
            password: SUPER_ADMIN_PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: "Bonie Munene" },
          });
          if (createError || !created.user) {
            return Response.json({ error: createError?.message ?? "create failed" }, { status: 500 });
          }
          userId = created.user.id;
        } else {
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: SUPER_ADMIN_PASSWORD,
            email_confirm: true,
          });
        }

        const roles = ["super_admin", "ops_admin", "finance_admin"] as const;
        const { error: roleError } = await supabaseAdmin
          .from("user_roles")
          .upsert(
            roles.map((role) => ({ user_id: userId!, role })),
            { onConflict: "user_id,role" },
          );
        if (roleError) return Response.json({ error: roleError.message }, { status: 500 });

        await supabaseAdmin
          .from("profiles")
          .upsert({ id: userId, email: SUPER_ADMIN_EMAIL, full_name: "Bonie Munene" });

        return Response.json({ status: "ok", userId });
      },
    },
  },
});

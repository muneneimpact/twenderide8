import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled reconciliation: no successful payment may stay pending because a
 * callback was lost. Cron-authenticated only.
 */
export const Route = createFileRoute("/api/public/payments/reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { reconcilePendingPayments } = await import("@/lib/payments.server");
        const result = await reconcilePendingPayments();
        return Response.json(result);
      },
    },
  },
});

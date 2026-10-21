import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** Daily document-expiry SMS (14 days, 3 days, day of expiry). Cron-authenticated only. */
export const Route = createFileRoute("/api/public/compliance/expiry-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { sendDocumentExpiryReminders } = await import("@/lib/sms-events.server");
        return Response.json(await sendDocumentExpiryReminders());
      },
    },
  },
});

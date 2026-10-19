import { createFileRoute } from "@tanstack/react-router";

/** Account provisioning is a privileged maintenance action, never a public API. */
export const Route = createFileRoute("/api/public/bootstrap-super-admin")({
  server: {
    handlers: {
      POST: async () => Response.json({ error: "Account bootstrap is disabled." }, { status: 410 }),
    },
  },
});

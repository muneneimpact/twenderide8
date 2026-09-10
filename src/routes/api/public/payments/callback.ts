import { createFileRoute } from "@tanstack/react-router";

/**
 * Twende Payments result callback.
 *
 * The payload is stored before anything is acted on, processing is idempotent,
 * and the endpoint always answers 2xx so the gateway never retries a payload we
 * already have.
 */
export const Route = createFileRoute("/api/public/payments/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const url = new URL(request.url);
        const token = process.env["PALPLUSS_CALLBACK_TOKEN"];
        const provided = url.searchParams.get("token") ?? request.headers.get("x-callback-token");
        const verified = !token || provided === token;

        if (token && !verified) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return Response.json({ received: true, ignored: "unreadable payload" });
        }

        const { normaliseTransaction } = await import("@/lib/adapters/palpluss.server");
        const { recordGatewayEvent, applyGatewayTransaction } = await import("@/lib/payments.server");

        const raw = (payload["transaction"] ?? payload) as Record<string, unknown>;
        const tx = normaliseTransaction(raw);
        if (!tx.id) return Response.json({ received: true, ignored: "no transaction id" });

        await recordGatewayEvent({
          transactionId: tx.id,
          eventType: String(payload["event_type"] ?? "transaction.updated"),
          status: tx.status,
          payload,
          verified,
        });

        try {
          const result = await applyGatewayTransaction(tx);
          return Response.json({ received: true, ...result });
        } catch (error) {
          console.error("payment callback processing failed", error);
          // Still acknowledge: reconciliation will pick this transaction up.
          return Response.json({ received: true, deferred: true });
        }
      },
    },
  },
});

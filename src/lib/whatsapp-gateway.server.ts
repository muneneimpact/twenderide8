/** WhatsApp sending through the Lovable connector gateway (server-only). */
export const WHATSAPP_GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp";

export function whatsappGatewayConfigured() {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env["WHATSAPP_API_KEY"]);
}

export function whatsappMissing(): string[] {
  return [
    !process.env["LOVABLE_API_KEY"] ? "LOVABLE_API_KEY" : null,
    !process.env["WHATSAPP_API_KEY"] ? "WhatsApp connection" : null,
  ].filter((v): v is string => Boolean(v));
}

/** Sends a /messages payload. Returns provider id or throws with Meta's status and body. */
export async function whatsappGatewaySend(body: Record<string, unknown>): Promise<string> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const waKey = process.env["WHATSAPP_API_KEY"];
  if (!lovableKey || !waKey) throw new Error("WhatsApp connection is not linked to this app yet.");
  const response = await fetch(`${WHATSAPP_GATEWAY_URL}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": waKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`WhatsApp send failed (${response.status}): ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text) as { messages?: Array<{ id?: string }> };
  const id = parsed.messages?.[0]?.id;
  if (!id) throw new Error(`WhatsApp returned no message id: ${text.slice(0, 200)}`);
  return id;
}

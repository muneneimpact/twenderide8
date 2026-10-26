import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway-run-id.server";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "openai/gpt-6-astra";

const vehicleInput = z.object({
  make: z.string().max(80).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
  seats: z.number().int().min(1).max(100).nullable().optional(),
  dailyRate: z.number().min(0).max(1_000_000).nullable().optional(),
  hireMode: z.enum(["self_drive", "chauffeured", "both"]).optional(),
  features: z.string().max(800).nullable().optional(),
});

const copySchema = z.object({
  headline: z.string().min(1).max(180),
  intro: z.string().min(1).max(500),
  highlights: z.array(z.string().min(1).max(140)).length(4),
});

/** Safe, user-facing reason extracted from a gateway error response. */
async function gatewayErrorReason(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return "";
  }
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const nested =
    record["error"] && typeof record["error"] === "object"
      ? (record["error"] as Record<string, unknown>)
      : record;
  const message = typeof nested["message"] === "string" ? nested["message"].trim() : "";
  if (!message || message.length > 300) return "";
  return message;
}

export const generateHireOwnerMarketingCopy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandName: z.string().trim().max(120).optional(),
        ownerBio: z.string().trim().max(1200).optional(),
        businessInfo: z.string().trim().max(1000).optional(),
        focus: z.enum(["executive", "family", "value", "safari"]),
        vehicle: vehicleInput,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI copy generation is not configured yet.");
    const vehicleName =
      [data.vehicle.make, data.vehicle.model].filter(Boolean).join(" ") || "hire car";
    const prompt = `Create tailored promotional copy for a Kenyan car-hire owner page. Return ONLY valid JSON with keys headline, intro, highlights (array of exactly 4 short strings). Do not invent awards, guarantees, availability, routes, or amenities. Use KES and natural Kenyan automotive terminology.\n\nBrand: ${data.brandName || "local hire provider"}\nOwner/company introduction: ${data.ownerBio || "not provided"}\nOperating information: ${data.businessInfo || "not provided"}\nVehicle: ${vehicleName}\nSeats: ${data.vehicle.seats ?? "not specified"}\nDaily rate: ${data.vehicle.dailyRate ? `KES ${data.vehicle.dailyRate.toLocaleString("en-KE")}` : "contact for rate"}\nHire mode: ${data.vehicle.hireMode || "not specified"}\nFeatures: ${data.vehicle.features || "not specified"}\nFocus: ${data.focus}`;

    const gateway = createLovableAiGatewayRunIdFetch();
    const response = await gateway.fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: LOVABLE_AI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You write truthful, polished marketing copy for Kenyan car-hire owners. Return JSON only.",
          },
          { role: "user", content: prompt },
        ],
        reasoning_effort: "low",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "hire_owner_marketing_copy",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                headline: { type: "string", maxLength: 180 },
                intro: { type: "string", maxLength: 500 },
                highlights: {
                  type: "array",
                  items: { type: "string", maxLength: 140 },
                  minItems: 4,
                  maxItems: 4,
                },
              },
              required: ["headline", "intro", "highlights"],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const reason = await gatewayErrorReason(response);
      throw new Error(
        reason
          ? `AI copy generation failed: ${reason}`
          : `AI copy generation failed (${response.status}).`,
      );
    }

    const json = await response.json();
    const content = String(json?.choices?.[0]?.message?.content || "")
      .replace(/```json\n?/g, "")
      .replace(/```/g, "")
      .trim();
    try {
      return copySchema.parse(JSON.parse(content));
    } catch {
      throw new Error("The AI returned copy in an unexpected format. Please try again.");
    }
  });

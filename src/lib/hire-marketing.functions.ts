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

const postSchema = z.object({
  channel: z.enum(["whatsapp", "facebook", "sms"]),
  label: z.string().min(1).max(60),
  text: z.string().min(1).max(500),
});

const copySchema = z.object({
  headline: z.string().min(1).max(180),
  intro: z.string().min(1).max(500),
  highlights: z.array(z.string().min(1).max(140)).length(4),
  posts: z.array(postSchema).length(3),
});

export type HireMarketingPost = z.infer<typeof postSchema>;

function currentPeriodKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function nextPeriodLabel(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month!, 1));
  return next.toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });
}

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

export const getHireMarketingQuota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const periodKey = currentPeriodKey();
    const { count, error } = await supabaseAdmin
      .from("hire_marketing_generations")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", context.userId)
      .eq("period_key", periodKey);
    if (error) throw new Error(error.message);
    return { periodKey, used: Number(count ?? 0), remaining: Math.max(0, 1 - Number(count ?? 0)) };
  });

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
  .handler(async ({ data, context }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI copy generation is not configured yet.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const periodKey = currentPeriodKey();
    const { error: reservationError } = await supabaseAdmin
      .from("hire_marketing_generations")
      .insert({ owner_user_id: context.userId, period_key: periodKey });
    if (reservationError) {
      if (reservationError.code === "23505") {
        throw new Error(
          `Your one owner marketing post for ${nextPeriodLabel(periodKey)} is already used.`,
        );
      }
      throw new Error(reservationError.message);
    }

    const vehicleName =
      [data.vehicle.make, data.vehicle.model].filter(Boolean).join(" ") || "hire car";
    const prompt = `Create tailored promotional copy for a Kenyan car-hire owner page. Return ONLY valid JSON with keys headline, intro, highlights (array of exactly 4 short strings), posts (array of exactly 3 objects with channel, label, text). The posts must be: one WhatsApp status, one Facebook post, and one short SMS. Do not invent awards, guarantees, availability, routes, contacts, or amenities. Use KES and natural Kenyan automotive terminology. Each post must tell people to view the owner booking page, but the application will add the tracked link later.

Brand: ${data.brandName || "local hire provider"}
Owner/company introduction: ${data.ownerBio || "not provided"}
Operating information: ${data.businessInfo || "not provided"}
Vehicle: ${vehicleName}
Seats: ${data.vehicle.seats ?? "not specified"}
Daily rate: ${data.vehicle.dailyRate ? `KES ${data.vehicle.dailyRate.toLocaleString("en-KE")}` : "contact for rate"}
Hire mode: ${data.vehicle.hireMode || "not specified"}
Features: ${data.vehicle.features || "not specified"}
Focus: ${data.focus}`;

    try {
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
                  posts: {
                    type: "array",
                    minItems: 3,
                    maxItems: 3,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        channel: { type: "string", enum: ["whatsapp", "facebook", "sms"] },
                        label: { type: "string", maxLength: 60 },
                        text: { type: "string", maxLength: 500 },
                      },
                      required: ["channel", "label", "text"],
                    },
                  },
                },
                required: ["headline", "intro", "highlights", "posts"],
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
      const copy = copySchema.parse(JSON.parse(content));
      const { error: saveError } = await supabaseAdmin
        .from("hire_owner_brands")
        .update({ marketing_posts: copy.posts, updated_at: new Date().toISOString() })
        .eq("owner_user_id", context.userId);
      if (saveError) throw new Error(saveError.message);
      return { ...copy, periodKey, used: 1, remaining: 0 };
    } catch (error) {
      await supabaseAdmin
        .from("hire_marketing_generations")
        .delete()
        .eq("owner_user_id", context.userId)
        .eq("period_key", periodKey);
      if (error instanceof Error && error.message) throw error;
      throw new Error("The AI returned copy in an unexpected format. Please try again.");
    }
  });

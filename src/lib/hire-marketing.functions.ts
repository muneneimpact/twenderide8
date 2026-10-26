import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const vehicleInput = z.object({
  make: z.string().max(80).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
  seats: z.number().int().min(1).max(100).nullable().optional(),
  dailyRate: z.number().min(0).max(1_000_000).nullable().optional(),
  hireMode: z.enum(["self_drive", "chauffeured", "both"]).optional(),
  features: z.string().max(800).nullable().optional(),
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
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI copy generation is not configured yet.");
    const vehicleName =
      [data.vehicle.make, data.vehicle.model].filter(Boolean).join(" ") || "hire car";
    const prompt = `Create tailored promotional copy for a Kenyan car-hire owner page. Return ONLY valid JSON with keys headline, intro, highlights (array of exactly 4 short strings). Do not invent awards, guarantees, availability, routes, or amenities. Use KES and natural Kenyan automotive terminology.\n\nBrand: ${data.brandName || "local hire provider"}\nOwner/company introduction: ${data.ownerBio || "not provided"}\nOperating information: ${data.businessInfo || "not provided"}\nVehicle: ${vehicleName}\nSeats: ${data.vehicle.seats ?? "not specified"}\nDaily rate: ${data.vehicle.dailyRate ? `KES ${data.vehicle.dailyRate.toLocaleString("en-KE")}` : "contact for rate"}\nHire mode: ${data.vehicle.hireMode || "not specified"}\nFeatures: ${data.vehicle.features || "not specified"}\nFocus: ${data.focus}`;
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        messages: [
          {
            role: "system",
            content:
              "You write truthful, polished marketing copy for Kenyan car-hire owners. Return JSON only.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });
    if (!response.ok) throw new Error(`AI copy generation failed (${response.status}).`);
    const json = await response.json();
    const content = String(json?.choices?.[0]?.message?.content || "")
      .replace(/```json\n?/g, "")
      .replace(/```/g, "")
      .trim();
    try {
      return z
        .object({
          headline: z.string().min(1).max(180),
          intro: z.string().min(1).max(500),
          highlights: z.array(z.string().min(1).max(140)).length(4),
        })
        .parse(JSON.parse(content));
    } catch {
      throw new Error("The AI returned copy in an unexpected format. Please try again.");
    }
  });

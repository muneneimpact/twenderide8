import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { listPublicHireVehicles } from "@/lib/hire.functions";

const requestSchema = z.object({
  tripNeeds: z.string().trim().min(10).max(1200),
});

const responseSchema = z.object({
  recommendations: z
    .array(
      z.object({
        vehicleId: z.string().uuid(),
        reason: z.string().trim().min(1).max(320),
      }),
    )
    .max(3),
});

function extractJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as unknown;
}

async function gatewayRequest(body: Record<string, unknown>) {
  const baseUrl = process.env.MANUS_API_URL;
  const apiKey = process.env.MANUS_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("AI recommendations are not configured yet.");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok || payload.error)
    throw new Error(payload.error?.message ?? "The recommendation service is unavailable.");
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The recommendation service returned no advice.");
  return content;
}

/** Recommend only vehicles that are in the current public catalogue. */
export const recommendHireVehicles = createServerFn({ method: "POST" })
  .inputValidator((input) => requestSchema.parse(input))
  .handler(async ({ data }) => {
    const vehicles = await listPublicHireVehicles();
    if (!vehicles.length) return { recommendations: [], catalogue: [] };
    const catalogue = vehicles.map((vehicle) => ({
      id: vehicle.id,
      name: [vehicle.make, vehicle.model, vehicle.year ? `(${vehicle.year})` : ""]
        .filter(Boolean)
        .join(" "),
      class: vehicle.vehicle_class,
      seats: vehicle.seats,
      mode: vehicle.hire_mode,
      dayRate: vehicle.day_rate,
      chauffeurDailyRate: vehicle.chauffeur_daily_rate,
      availableNow: vehicle.bookings.length === 0,
      bookedRanges: vehicle.bookings,
      paymentPolicy: vehicle.hire_payment_policy,
      payLaterAllowed: vehicle.hire_pay_later_allowed,
      depositPolicy: vehicle.hire_deposit_policy,
      depositAmount: vehicle.hire_deposit_amount,
      cancellationPolicy: vehicle.hire_cancellation_policy,
      insuranceType: vehicle.hire_insurance_type,
      insuranceDetails: vehicle.hire_insurance_details,
      minimumDriverAge: vehicle.hire_minimum_age,
      description: vehicle.hire_description,
      features: vehicle.hire_features,
      notes: vehicle.hire_notes,
      rules: vehicle.hire_rules,
    }));
    const model = process.env.AI_GATEWAY_MODEL;
    const content = await gatewayRequest({
      ...(model ? { model } : {}),
      messages: [
        {
          role: "system",
          content:
            'You match car-hire requests to the supplied public catalogue. Use only vehicle IDs from the catalogue. Recommend only vehicles marked availableNow=true and never recommend a vehicle with any bookedRanges. Consider passenger seats, vehicle class, self-drive/driver mode, daily rates, chauffeur fees, deposits, payment and pay-later policy, minimum driver age, insurance, cancellation policy, features, rules, notes, and the requested trip dates, duration, budget and luggage. Never invent availability, prices, policies, or features. Return JSON exactly as {"recommendations":[{"vehicleId":"uuid","reason":"short plain-English reason"}]} with at most 3 recommendations. If no available vehicle fits, return an empty array.',
        },
        { role: "user", content: JSON.stringify({ tripNeeds: data.tripNeeds, catalogue }) },
      ],
      ...(model
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "vehicle_recommendations",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    recommendations: {
                      type: "array",
                      maxItems: 3,
                      items: {
                        type: "object",
                        properties: { vehicleId: { type: "string" }, reason: { type: "string" } },
                        required: ["vehicleId", "reason"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["recommendations"],
                  additionalProperties: false,
                },
              },
            },
          }
        : {}),
    });
    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(extractJson(content));
    } catch {
      throw new Error("The recommendation service returned an invalid response.");
    }
    const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const recommendations = parsed.recommendations
      .filter(({ vehicleId }) => {
        const vehicle = byId.get(vehicleId);
        return Boolean(vehicle && vehicle.bookings.length === 0);
      })
      .map((recommendation) => ({
        ...recommendation,
        vehicle: byId.get(recommendation.vehicleId)!,
      }));
    return { recommendations, catalogue: vehicles };
  });

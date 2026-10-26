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

const inquiryInput = z.object({
  slug: z.string().trim().min(1).max(80),
  customerName: z.string().trim().min(2).max(100),
  customerPhone: z
    .string()
    .trim()
    .regex(/^(?:07|01)\d{8}$|^\+254[17]\d{8}$/, "Enter a valid Kenyan phone number."),
  customerEmail: z.string().trim().email().max(160).optional().or(z.literal("")),
  vehicleId: z.string().uuid().nullable().optional(),
  serviceType: z.enum(["self_drive", "chauffeured", "hourly", "general"]),
  datesNote: z.string().trim().max(160).optional(),
  message: z.string().trim().min(10).max(1200),
});

export const submitPublicHireInquiry = createServerFn({ method: "POST" })
  .inputValidator((input) => inquiryInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brand, error: brandError } = await supabaseAdmin
      .from("hire_owner_brands")
      .select("owner_user_id, brand_name, slug")
      .eq("slug", data.slug.toLowerCase())
      .maybeSingle();
    if (brandError || !brand) throw new Error("This hire page is no longer available.");

    let vehicleName = "Any available car";
    if (data.vehicleId) {
      const { data: vehicle } = await supabaseAdmin
        .from("vehicles")
        .select("make, model")
        .eq("id", data.vehicleId)
        .maybeSingle();
      if (!vehicle) throw new Error("That vehicle is not available on this hire page.");
      vehicleName = [vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicleName;
    }
    const serviceLabel =
      data.serviceType === "self_drive"
        ? "Self-drive"
        : data.serviceType === "chauffeured"
          ? "With driver"
          : data.serviceType === "hourly"
            ? "Hourly"
            : "General question";
    const message = `Vehicle: ${vehicleName}\nService: ${serviceLabel}${data.datesNote ? `\nDates / timing: ${data.datesNote}` : ""}\n\n${data.message}`;
    const { error } = await supabaseAdmin.from("hire_owner_inquiries").insert({
      owner_user_id: brand.owner_user_id,
      brand_slug: brand.slug,
      customer_name: data.customerName,
      customer_phone: data.customerPhone,
      customer_email: data.customerEmail || null,
      vehicle_id: data.vehicleId || null,
      service_type: data.serviceType,
      dates_note: data.datesNote || null,
      message,
    });
    if (error) throw new Error("We could not send your enquiry. Please try again or use WhatsApp.");
    const { notify } = await import("./notifications.server");
    await notify({
      userId: brand.owner_user_id,
      templateCode: "hire_owner_inquiry_new",
      title: "New car-hire inquiry",
      body: `New inquiry from ${data.customerName} (${data.customerPhone}) for ${vehicleName}. Check your hire inbox on Twende.`,
      critical: true,
      dedupeKey: `hire-inquiry:${brand.slug}:${data.customerPhone}:${Date.now()}`,
    });
    return { ok: true };
  });

export const listHireOwnerInquiries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hire_owner_inquiries")
      .select(
        "id, brand_slug, customer_name, customer_phone, customer_email, vehicle_id, service_type, dates_note, message, status, created_at, vehicles(make, model)",
      )
      .eq("owner_user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateHireOwnerInquiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ id: z.string().uuid(), status: z.enum(["new", "contacted", "closed"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("hire_owner_inquiries")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("owner_user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

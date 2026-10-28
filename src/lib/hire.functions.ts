/**
 * Car hire and corporate bookings.
 *
 * Two very different things share this file:
 *
 *  - Vehicle hire: customers browse approved listings, select an available
 *    date range, and book self-drive or chauffeured cars at the displayed rate.
 *  - Custom corporate quotations remain available without a specific listing.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const VEHICLE_CLASSES = ["go", "plus", "comfort", "xl", "boda", "e_boda"] as const;
type VehicleClass = (typeof VEHICLE_CLASSES)[number];
type HirePaymentPolicy = "full" | "daily_flexible";

const stopSchema = z.object({
  label: z.string().min(2).max(160),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

/** Indicative day rates, used only when a listing has no rate of its own. */
const DAY_RATE: Record<VehicleClass, number> = {
  boda: 2500,
  e_boda: 2500,
  go: 8000,
  plus: 10000,
  comfort: 12000,
  xl: 16000,
};

const CHAUFFEUR_DAY_RATE = 2500;
const STOP_ALLOWANCE = 600;
const DAY_MS = 86_400_000;

function nairobiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function blackoutWindow(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00+03:00`);
  const end = new Date(new Date(`${endDate}T00:00:00+03:00`).getTime() + DAY_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function estimateHireTotal(input: {
  vehicleClass: VehicleClass;
  driveMode: "self_drive" | "chauffeured";
  days: number;
  stops: number;
  dailyRate?: number | null;
  chauffeurDailyRate?: number | null;
}) {
  const base =
    input.dailyRate && input.dailyRate > 0 ? input.dailyRate : DAY_RATE[input.vehicleClass];
  const chauffeurRate = input.chauffeurDailyRate ?? CHAUFFEUR_DAY_RATE;
  const perDay = base + (input.driveMode === "chauffeured" ? chauffeurRate : 0);
  const extraStops = Math.max(0, input.stops - 2) * STOP_ALLOWANCE;
  return Math.round(perDay * input.days + extraStops);
}

export interface HireVehicleRow {
  id: string;
  plate_number: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  year: number | null;
  seats: number | null;
  vehicle_class: VehicleClass;
  hire_mode: string | null;
  hire_payment_policy: HirePaymentPolicy;
  hire_deposit_policy?: string | null;
  hire_pay_later_allowed?: boolean | null;
  hire_deposit_amount?: number | null;
  hire_daily_rate: number | null;
  hire_cancellation_policy: string;
  hire_chauffeur_daily_rate: number | null;
  hire_insurance_type: string | null;
  hire_insurance_details: string | null;
  hire_minimum_age: number | null;
  hire_notes: string | null;
  hire_description: string | null;
  hire_features: string | null;
  hire_available: boolean;
  hire_hourly_available?: boolean;
  hire_approval_status: string;
  hire_rejection_reason: string | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  hire_rules: string | null;
  status: string;
  owner_driver_id?: string | null;
  fleet_id?: string | null;
}

/** Photos live in a private bucket, so customers get short-lived links. */
async function withPhotos(
  rows: HireVehicleRow[],
): Promise<
  Array<HireVehicleRow & { photo_link: string | null; photo_links: string[]; photo_paths: string[] }>
> {
  const allFor = (row: HireVehicleRow) =>
    [row.photo_url, ...(row.photo_urls ?? [])].filter(
      (value, index, list): value is string => Boolean(value) && list.indexOf(value) === index,
    );
  const paths = [...new Set(rows.flatMap(allFor))];
  if (paths.length === 0)
    return rows.map((row) => ({ ...row, photo_link: null, photo_links: [], photo_paths: [] }));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const signedResults = await Promise.all(
    Array.from({ length: Math.ceil(paths.length / 100) }, (_, index) =>
      supabaseAdmin.storage
        .from("vehicle-photos")
        .createSignedUrls(paths.slice(index * 100, (index + 1) * 100), 3600),
    ),
  );
  const links = new Map(
    signedResults.flatMap(({ data }) =>
      (data ?? []).map((item) => [item.path, item.signedUrl] as const),
    ),
  );
  return rows.map((row) => {
    const photoPaths = allFor(row).filter((path) => links.has(path));
    const photoLinks = photoPaths.map((path) => links.get(path)!);
    return {
      ...row,
      photo_link: photoLinks[0] ?? null,
      photo_links: photoLinks,
      photo_paths: photoPaths,
    };
  });
}

async function managedVehicleScope(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: fleets, error } = await supabaseAdmin
    .from("fleets")
    .select("id")
    .eq("owner_id", userId);
  if (error) throw new Error(error.message);
  const fleetIds = (fleets ?? []).map((fleet) => fleet.id);
  return {
    fleetIds,
    filter: fleetIds.length
      ? `owner_driver_id.eq.${userId},fleet_id.in.(${fleetIds.join(",")})`
      : `owner_driver_id.eq.${userId}`,
  };
}

async function requireManagedVehicle(userId: string, vehicleId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: vehicle, error }, { fleetIds }] = await Promise.all([
    supabaseAdmin
      .from("vehicles")
      .select("id, owner_driver_id, fleet_id")
      .eq("id", vehicleId)
      .maybeSingle(),
    managedVehicleScope(userId),
  ]);
  if (error) throw new Error(error.message);
  if (
    !vehicle ||
    (vehicle.owner_driver_id !== userId &&
      (!vehicle.fleet_id || !fleetIds.includes(vehicle.fleet_id)))
  ) {
    throw new Error("Vehicle not found or you do not manage it.");
  }
  return vehicle;
}

const VEHICLE_FIELDS =
  "id, plate_number, make, model, colour, year, seats, vehicle_class, hire_mode, hire_payment_policy, hire_deposit_policy, hire_deposit_amount, hire_daily_rate, hire_cancellation_policy, hire_chauffeur_daily_rate, hire_insurance_type, hire_insurance_details, hire_minimum_age, hire_notes, hire_description, hire_features, hire_available, hire_hourly_available, hire_approval_status, hire_rejection_reason, photo_url, photo_urls, hire_rules, status, owner_driver_id, fleet_id";
const PUBLIC_HIRE_VEHICLE_FIELDS =
  "id, plate_number, make, model, colour, year, seats, vehicle_class, hire_mode, hire_payment_policy, hire_deposit_policy, hire_deposit_amount, hire_pay_later_allowed, hire_daily_rate, hire_cancellation_policy, hire_chauffeur_daily_rate, hire_insurance_type, hire_insurance_details, hire_minimum_age, hire_notes, hire_description, hire_features, hire_available, hire_hourly_available, hire_approval_status, hire_rejection_reason, photo_url, photo_urls, hire_rules, status, owner_driver_id, fleet_id";

/** Every approved car currently listed for hire. */
export const listHireVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => loadAvailableHireVehicles());

/**
 * Public browse list for signed-out visitors: car, price and booked dates only —
 * never plate, owner, insurance or internal notes. Booking still needs sign-in.
 */
export const listPublicHireVehicles = createServerFn({ method: "GET" }).handler(async () => {
  const list = await loadAvailableHireVehicles();
  return list.map((v) => ({
    id: v.id,
    make: v.make,
    model: v.model,
    colour: v.colour,
    year: v.year,
    seats: v.seats,
    vehicle_class: v.vehicle_class,
    hire_mode: v.hire_mode,
    hire_hourly_available: Boolean((v as unknown as { hire_hourly_available?: boolean }).hire_hourly_available),
    hire_payment_policy: v.hire_payment_policy,
    hire_pay_later_allowed: v.hire_pay_later_allowed,
    hire_deposit_policy: v.hire_deposit_policy,
    hire_deposit_amount: v.hire_deposit_amount,
    hire_cancellation_policy: v.hire_cancellation_policy,
    hire_insurance_type: v.hire_insurance_type,
    hire_insurance_details: v.hire_insurance_details,
    hire_minimum_age: v.hire_minimum_age,
    hire_description: v.hire_description,
    hire_features: v.hire_features,
    hire_notes: v.hire_notes,
    hire_rules: v.hire_rules,
    photo_link: v.photo_link,
    photo_links: v.photo_links,
    bookings: v.bookings,
    day_rate: v.day_rate,
    chauffeur_daily_rate: v.chauffeur_daily_rate,
  }));
});

export const getMyHireBrand = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hire_owner_brands")
      .select("brand_name, slug, logo_data_url, cover_image_data_url, accent_color, owner_bio, business_info, marketing_content, marketing_posts, profile_type")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const listMyTrustedBrands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("hire_owner_trusted_brands")
      .select("id, brand_name, permission_confirmed, status, admin_note, created_at")
      .eq("owner_user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const requestTrustedBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandName: z.string().trim().min(2).max(120), permissionConfirmed: z.literal(true) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("hire_owner_trusted_brands")
      .upsert({ owner_user_id: context.userId, brand_name: data.brandName, permission_confirmed: true, status: "pending", updated_at: new Date().toISOString() }, { onConflict: "owner_user_id,brand_name" })
      .select("id, brand_name, permission_confirmed, status, admin_note, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const saveMyHireBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandName: z.string().trim().min(2).max(80),
        logoDataUrl: z.string().max(450_000).nullable(),
        coverImageDataUrl: z.string().max(700_000).nullable(),
        accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
        marketingPosts: z.array(
          z.object({
            channel: z.enum(["whatsapp", "facebook", "sms"]),
            label: z.string().min(1).max(60),
            text: z.string().min(1).max(500),
          }),
        ).max(3).optional(),
        ownerBio: z.string().trim().max(1200),
        businessInfo: z.string().trim().max(1000),
        marketingContent: z.string().trim().max(1500),
        profileType: z.enum(["person", "company"]).default("person"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (
      data.logoDataUrl &&
      !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(data.logoDataUrl)
    ) {
      throw new Error("Upload a PNG, JPG or WebP logo image.");
    }
    if (data.coverImageDataUrl && !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(data.coverImageDataUrl)) {
      throw new Error("Upload a PNG, JPG or WebP cover image.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { filter } = await managedVehicleScope(context.userId);
    const { data: ownedVehicles, error: ownerError } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .or(filter)
      .limit(1);
    if (ownerError) throw new Error(ownerError.message);
    if (!ownedVehicles?.length) throw new Error("Add or manage a hire vehicle before creating your owner page.");
    const baseSlug = data.brandName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56)
      .replace(/-+$/g, "");
    if (!baseSlug) throw new Error("Choose a brand name that can be used in a web address.");
    const reservedSlugs = new Set([
      "admin", "auth", "book", "cars", "driver", "fleet", "hire", "rides", "account",
      "company", "drive-or-list", "forgot-password", "privacy", "terms", "status",
    ]);
    if (reservedSlugs.has(baseSlug)) throw new Error("That brand name is reserved. Choose another name for your page.");
    const { data: existing } = await supabaseAdmin
      .from("hire_owner_brands")
      .select("slug, brand_name")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    const { data: collision, error: collisionError } = await supabaseAdmin
      .from("hire_owner_brands")
      .select("owner_user_id")
      .eq("slug", baseSlug)
      .maybeSingle();
    if (collisionError) throw new Error(collisionError.message);
    // Keep the owner's existing shared link when the brand name is unchanged.
    const slug = existing && existing.brand_name.trim() === data.brandName
      ? existing.slug
      : collision && collision.owner_user_id !== context.userId
        ? `${baseSlug.slice(0, 48)}-${context.userId.slice(0, 7).toLowerCase()}`
        : baseSlug;
    const { data: saved, error } = await supabaseAdmin
      .from("hire_owner_brands")
      .upsert(
        {
          owner_user_id: context.userId,
          brand_name: data.brandName,
          slug,
          logo_data_url: data.logoDataUrl,
          cover_image_data_url: data.coverImageDataUrl,
          accent_color: data.accentColor,
          ...(data.marketingPosts ? { marketing_posts: data.marketingPosts } : {}),
          owner_bio: data.ownerBio,
          business_info: data.businessInfo,
          marketing_content: data.marketingContent,
          profile_type: data.profileType,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_user_id" },
      )
      .select("brand_name, slug, logo_data_url, cover_image_data_url, accent_color, owner_bio, business_info, marketing_content, marketing_posts, profile_type")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("That brand name is already in use. Choose a unique name.");
      throw new Error(error.message);
    }
    return saved;
  });

export const getPublicHireBrand = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ slug: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brand, error } = await supabaseAdmin
      .from("hire_owner_brands")
      .select("owner_user_id, brand_name, slug, logo_data_url, cover_image_data_url, accent_color, owner_bio, business_info, marketing_content, marketing_posts, profile_type")
      .eq("slug", data.slug.toLowerCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!brand) return null;
    const { data: promotions } = await (supabaseAdmin as any)
      .from("hire_owner_promotions")
      .select("id, title, description, reward_points, discount_percent, merchandise, expires_at")
      .eq("owner_user_id", brand.owner_user_id)
      .eq("status", "active")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(3);
    const [{ data: profile }, { data: fleets }, { data: trustedBrands }, available] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("full_name, avatar_url, company_name")
        .eq("id", brand.owner_user_id)
        .maybeSingle(),
      supabaseAdmin.from("fleets").select("id").eq("owner_id", brand.owner_user_id),
      (supabaseAdmin as any)
        .from("hire_owner_trusted_brands")
        .select("brand_name")
        .eq("owner_user_id", brand.owner_user_id)
        .eq("status", "approved")
        .eq("permission_confirmed", true)
        .order("brand_name"),
      loadAvailableHireVehicles(),
    ]);
    const fleetIds = (fleets ?? []).map((fleet) => fleet.id);
    const vehicles = available
      .filter((vehicle) =>
        vehicle.owner_driver_id === brand.owner_user_id ||
        Boolean(vehicle.fleet_id && fleetIds.includes(vehicle.fleet_id)),
      )
      .map((vehicle) => ({
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        colour: vehicle.colour,
        year: vehicle.year,
        seats: vehicle.seats,
        vehicle_class: vehicle.vehicle_class,
        hire_mode: vehicle.hire_mode,
        hire_hourly_available: vehicle.hire_hourly_available,
        hire_payment_policy: vehicle.hire_payment_policy,
        hire_pay_later_allowed: vehicle.hire_pay_later_allowed,
        hire_deposit_policy: vehicle.hire_deposit_policy,
        hire_deposit_amount: vehicle.hire_deposit_amount,
        hire_cancellation_policy: vehicle.hire_cancellation_policy,
        hire_description: vehicle.hire_description,
        hire_features: vehicle.hire_features,
        photo_link: vehicle.photo_link,
        photo_links: vehicle.photo_links,
        bookings: vehicle.bookings,
        day_rate: vehicle.day_rate,
        chauffeur_daily_rate: vehicle.chauffeur_daily_rate,
      }));
    return {
      brand: {
        brand_name: brand.brand_name,
        slug: brand.slug,
        logo_data_url: brand.logo_data_url,
        cover_image_data_url: brand.cover_image_data_url,
        accent_color: brand.accent_color,
        owner_bio: brand.owner_bio,
        business_info: brand.business_info,
        marketing_content: brand.marketing_content,
        marketing_posts: brand.marketing_posts,
        profile_type: brand.profile_type,
      },
      trusted_brands: (trustedBrands ?? []).map((row: { brand_name: string }) => row.brand_name),
      promotions: promotions ?? [],
      owner: {
        full_name: profile?.full_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
        company_name: profile?.company_name ?? null,
      },
      vehicles,
    };
  });

async function loadAvailableHireVehicles() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pageSize = 500;
    const rows: HireVehicleRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from("vehicles")
        .select(PUBLIC_HIRE_VEHICLE_FIELDS)
        .eq("hire_available", true)
        .eq("hire_approval_status", "approved")
        .eq("status", "approved")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`Could not load available hire vehicles: ${error.message}`);
      rows.push(...((data ?? []) as unknown as HireVehicleRow[]));
      if ((data ?? []).length < pageSize) break;
    }
    const list = await withPhotos(rows);
    // Booked dates only (no customer details), so people can pick free days.
    const ids = list.map((vehicle) => vehicle.id);
    const booked: Array<{
      vehicle_id: string | null;
      start_at: string;
      end_at: string | null;
      days: number;
      status: string;
      payment_status: string;
      payment_hold_expires_at: string | null;
      pay_later_method: string | null;
    }> = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await supabaseAdmin
        .from("hire_quotes")
        .select(
          "vehicle_id, start_at, end_at, days, status, payment_status, payment_hold_expires_at, pay_later_method",
        )
        .in("vehicle_id", ids.slice(offset, offset + 100))
        .in("status", ["submitted", "quoted", "confirmed"])
        .gte("start_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
      if (error) throw new Error(`Could not load hire availability: ${error.message}`);
      booked.push(...((data ?? []) as typeof booked));
    }
    const offline: Array<{ vehicle_id: string; start_date: string; end_date: string }> = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await supabaseAdmin
        .from("hire_vehicle_blackouts")
        .select("vehicle_id, start_date, end_date")
        .in("vehicle_id", ids.slice(offset, offset + 100))
        .gte("end_date", nairobiDateKey());
      if (error) throw new Error(`Could not load offline hire dates: ${error.message}`);
      offline.push(...((data ?? []) as typeof offline));
    }
    return list.map((vehicle) => ({
      ...vehicle,
      bookings: [
        ...booked
        .filter(
          (row) =>
            row.vehicle_id === vehicle.id &&
            (["legacy", "partial", "paid"].includes(row.payment_status) ||
              (row.status === "confirmed" && Boolean(row.pay_later_method)) ||
              (row.payment_status === "pending" &&
                Boolean(
                  row.payment_hold_expires_at &&
                  new Date(row.payment_hold_expires_at).getTime() > Date.now(),
                ))),
        )
        .map((row) => ({
          start: row.start_at,
          end:
            row.end_at ??
            new Date(new Date(row.start_at).getTime() + row.days * 86_400_000).toISOString(),
        }))
        .filter((range) => new Date(range.end).getTime() > Date.now()),
        ...offline
          .filter((range) => range.vehicle_id === vehicle.id)
          .map((range) => blackoutWindow(range.start_date, range.end_date)),
      ],
      day_rate:
        Number(vehicle.hire_daily_rate ?? 0) > 0
          ? Number(vehicle.hire_daily_rate)
          : DAY_RATE[vehicle.vehicle_class ?? "go"],
      chauffeur_daily_rate: Number(vehicle.hire_chauffeur_daily_rate ?? CHAUFFEUR_DAY_RATE),
    }));
}

/** Cars I own (directly or through my fleet), for managing their listing. */
export const listMyVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets, error: fleetError } = await supabaseAdmin
      .from("fleets")
      .select("id")
      .eq("owner_id", context.userId);
    if (fleetError) throw new Error(fleetError.message);
    const fleetIds = (fleets ?? []).map((fleet) => fleet.id);
    const filter = fleetIds.length
      ? `owner_driver_id.eq.${context.userId},fleet_id.in.(${fleetIds.join(",")})`
      : `owner_driver_id.eq.${context.userId}`;
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .select(VEHICLE_FIELDS)
      .or(filter)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = await withPhotos((data ?? []) as unknown as HireVehicleRow[]);
    const vehicleIds = list.map((vehicle) => vehicle.id);
    const now = new Date().toISOString();
    const { data: bookings } = vehicleIds.length
      ? await supabaseAdmin
          .from("hire_quotes")
          .select(
            "vehicle_id, start_at, end_at, days, status, payment_status, payment_hold_expires_at, pay_later_method",
          )
          .in("vehicle_id", vehicleIds)
          .in("status", ["submitted", "quoted", "confirmed"])
          .or(`end_at.gte.${now},end_at.is.null`)
      : {
          data: [] as Array<{
            vehicle_id: string | null;
            start_at: string;
            end_at: string | null;
            days: number;
            status: string;
            payment_status: string;
            payment_hold_expires_at: string | null;
            pay_later_method: string | null;
          }>,
        };
    const { data: offlineHires, error: offlineError } = vehicleIds.length
      ? await supabaseAdmin
          .from("hire_vehicle_blackouts")
          .select("id, vehicle_id, start_date, end_date, note, created_at")
          .in("vehicle_id", vehicleIds)
          .order("start_date", { ascending: true })
      : { data: [] as Array<{ id: string; vehicle_id: string; start_date: string; end_date: string; note: string; created_at: string }> };
    if (offlineError) throw new Error(`Could not load offline hire dates: ${offlineError.message}`);
    return list.map((vehicle) => ({
      ...vehicle,
      hire_bookings: (bookings ?? [])
        .filter(
          (booking) =>
            booking.vehicle_id === vehicle.id &&
            (["legacy", "partial", "paid"].includes(booking.payment_status) ||
              (booking.status === "confirmed" && Boolean(booking.pay_later_method)) ||
              (booking.payment_status === "pending" &&
                Boolean(
                  booking.payment_hold_expires_at &&
                  new Date(booking.payment_hold_expires_at).getTime() > Date.now(),
                ))),
        )
        .map((booking) => ({
          start: booking.start_at,
          end:
            booking.end_at ??
            new Date(
              new Date(booking.start_at).getTime() + booking.days * 86_400_000,
            ).toISOString(),
          status: booking.status,
        })),
      offline_hires: (offlineHires ?? [])
        .filter((offlineHire) => offlineHire.vehicle_id === vehicle.id)
        .map(({ vehicle_id: _vehicleId, ...offlineHire }) => offlineHire),
    }));
  });

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Choose a valid calendar date.");

export const createOfflineHire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        startDate: calendarDateSchema,
        endDate: calendarDateSchema,
        note: z.string().trim().max(200).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const vehicle = await requireManagedVehicle(context.userId, data.vehicleId);
    if (data.endDate < data.startDate) throw new Error("End date must be on or after the start date.");
    if (data.startDate < nairobiDateKey()) throw new Error("Offline hire dates must start today or later.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("hire_quotes")
      .select("start_at, end_at, days, status, payment_status, payment_hold_expires_at, pay_later_method")
      .eq("vehicle_id", data.vehicleId)
      .in("status", ["submitted", "quoted", "confirmed"]);
    if (existingError) throw new Error(`Could not verify existing bookings: ${existingError.message}`);
    const window = blackoutWindow(data.startDate, data.endDate);
    const activeBooking = (existing ?? []).some((booking) => {
      const active =
        ["legacy", "partial", "paid"].includes(booking.payment_status) ||
        (booking.status === "confirmed" && Boolean(booking.pay_later_method)) ||
        (booking.payment_status === "pending" &&
          Boolean(booking.payment_hold_expires_at && new Date(booking.payment_hold_expires_at).getTime() > Date.now()));
      const bookingEnd = booking.end_at ?? new Date(new Date(booking.start_at).getTime() + booking.days * DAY_MS).toISOString();
      return active && new Date(booking.start_at).getTime() < new Date(window.end).getTime() && new Date(bookingEnd).getTime() > new Date(window.start).getTime();
    });
    if (activeBooking) throw new Error("Those dates overlap an existing platform booking.");
    const { data: row, error } = await supabaseAdmin
      .from("hire_vehicle_blackouts")
      .insert({
        vehicle_id: vehicle.id,
        owner_user_id: context.userId,
        start_date: data.startDate,
        end_date: data.endDate,
        note: data.note,
      })
      .select("id, vehicle_id, start_date, end_date, note, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteOfflineHire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error: loadError } = await supabaseAdmin
      .from("hire_vehicle_blackouts")
      .select("id, vehicle_id")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!row) throw new Error("Offline hire dates not found.");
    await requireManagedVehicle(context.userId, row.vehicle_id);
    const { error } = await supabaseAdmin
      .from("hire_vehicle_blackouts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Owners save listing details; Ops approval is required before public hire. */
export const updateVehicleHire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        vehicleId: z.string().uuid(),
        hireAvailable: z.boolean().optional(),
        hourlyAvailable: z.boolean().optional(),
        hireMode: z.enum(["self_drive", "chauffeured", "both"]).optional(),
        paymentPolicy: z.enum(["full", "daily_flexible"]).optional(),
        dailyRate: z.number().min(0).max(1_000_000).nullable().optional(),
        chauffeurDailyRate: z.number().min(0).max(1_000_000).optional(),
        seats: z.number().int().min(1).max(60).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        features: z.string().max(800).nullable().optional(),
        addPhotoPath: z.string().max(400).optional(),
        addPhotoPaths: z.array(z.string().max(400)).max(12).optional(),
        removePhotoPath: z.string().max(400).optional(),
        rules: z.string().max(2000).nullable().optional(),
        cancellationPolicy: z.string().trim().max(2000).optional(),
        applyCancellationPolicyToOwner: z.boolean().optional(),
        insuranceType: z
          .enum(["comprehensive", "third_party_fire_theft", "third_party_only", "psv_commercial", "other"])
          .nullable()
          .optional(),
        insuranceDetails: z.string().trim().max(200).nullable().optional(),
        minimumAge: z.number().int().min(18).max(100).nullable().optional(),
        submitForHireReview: z.boolean().optional(),
        depositPolicy: z.enum(["upfront", "handover", "none"]).optional(),
        depositAmount: z.number().min(0).max(1_000_000).optional(),
        payLaterAllowed: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets, error: fleetError } = await supabaseAdmin
      .from("fleets")
      .select("id")
      .eq("owner_id", context.userId);
    if (fleetError) throw new Error(fleetError.message);
    const fleetIds = (fleets ?? []).map((fleet) => fleet.id);
    const ownerFilter = fleetIds.length
      ? `owner_driver_id.eq.${context.userId},fleet_id.in.(${fleetIds.join(",")})`
      : `owner_driver_id.eq.${context.userId}`;
    const { data: current, error: loadError } = await supabaseAdmin
      .from("vehicles")
      .select(
        "id, owner_driver_id, fleet_id, status, hire_mode, hire_available, hire_approval_status, hire_daily_rate, hire_payment_policy, photo_url, photo_urls",
      )
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    const isDirectOwner = current?.owner_driver_id === context.userId;
    const isFleetOwner = Boolean(current?.fleet_id && fleetIds.includes(current.fleet_id));
    if (!current || (!isDirectOwner && !isFleetOwner)) {
      throw new Error("Vehicle not found or you do not manage it.");
    }
    if (
      data.hourlyAvailable === true &&
      (data.hireMode ?? current.hire_mode) === "self_drive"
    ) {
      throw new Error("Choose Chauffeured only or Both for this car, save it, then enable hourly trips.");
    }

    const patch: Record<string, unknown> = {};
    if (data.hireMode !== undefined) patch["hire_mode"] = data.hireMode;
    if (data.hourlyAvailable !== undefined) patch["hire_hourly_available"] = data.hourlyAvailable;
    if (data.paymentPolicy !== undefined) patch["hire_payment_policy"] = data.paymentPolicy;
    if (data.depositPolicy !== undefined) {
      if (data.depositPolicy !== "none" && !(data.depositAmount && data.depositAmount > 0))
        throw new Error("Enter the deposit amount, or choose No deposit.");
      patch["hire_deposit_policy"] = data.depositPolicy;
      patch["hire_deposit_amount"] = data.depositPolicy === "none" ? 0 : data.depositAmount;
    }
    if (data.payLaterAllowed !== undefined) patch["hire_pay_later_allowed"] = data.payLaterAllowed;
    if (data.dailyRate !== undefined) patch["hire_daily_rate"] = data.dailyRate;
    if (data.chauffeurDailyRate !== undefined)
      patch["hire_chauffeur_daily_rate"] = data.chauffeurDailyRate;
    if (data.seats !== undefined) patch["seats"] = data.seats;
    if (data.description !== undefined) patch["hire_description"] = data.description;
    if (data.features !== undefined) patch["hire_features"] = data.features;
    if (data.rules !== undefined) patch["hire_rules"] = data.rules;
    if (data.cancellationPolicy !== undefined) {
      patch["hire_cancellation_policy"] =
        data.cancellationPolicy ||
        "Submit cancellation requests through Twende Meru Rides. Any refund or deduction is subject to platform review; do not settle cancellations off-platform.";
    }
    if (data.insuranceType !== undefined) patch["hire_insurance_type"] = data.insuranceType;
    if (data.insuranceDetails !== undefined)
      patch["hire_insurance_details"] = data.insuranceDetails || null;
    if (data.minimumAge !== undefined) patch["hire_minimum_age"] = data.minimumAge;

    if (data.applyCancellationPolicyToOwner && data.cancellationPolicy !== undefined) {
      const cancellationPolicy =
        data.cancellationPolicy ||
        "Submit cancellation requests through Twende Meru Rides. Any refund or deduction is subject to platform review; do not settle cancellations off-platform.";
      const { error: policyError } = await supabaseAdmin
        .from("vehicles")
        .update({ hire_cancellation_policy: cancellationPolicy } as never)
        .or(ownerFilter);
      if (policyError)
        throw new Error(`Could not apply cancellation policy: ${policyError.message}`);
      // Previously approved cars stay live: the new terms apply to future bookings
      // without pulling other listings off the marketplace.
    }

    const photoAdds = [
      ...(data.addPhotoPaths ?? []),
      ...(data.addPhotoPath ? [data.addPhotoPath] : []),
    ];
    if (photoAdds.some((path) => !path.startsWith(`${data.vehicleId}/`))) {
      throw new Error("Upload vehicle photos again from this vehicle's listing.");
    }
    if (data.removePhotoPath && !data.removePhotoPath.startsWith(`${data.vehicleId}/`)) {
      throw new Error("That photo does not belong to this vehicle.");
    }
    if (photoAdds.length || data.removePhotoPath) {
      let photos = [
        ...new Set([
          ...(current.photo_url ? [current.photo_url] : []),
          ...((current.photo_urls ?? []) as string[]),
        ]),
      ];
      if (data.removePhotoPath && !photos.includes(data.removePhotoPath)) {
        throw new Error("That vehicle photo is no longer on this listing.");
      }
      photos = photos.filter((path) => path !== data.removePhotoPath);
      photos = [...new Set([...photos, ...photoAdds])].slice(0, 12);
      patch["photo_urls"] = photos;
      patch["photo_url"] = photos[0] ?? null;
    }

    const listingChanged =
      data.hireMode !== undefined ||
      data.dailyRate !== undefined ||
      data.seats !== undefined ||
      data.description !== undefined ||
      data.features !== undefined ||
      data.rules !== undefined ||
      data.chauffeurDailyRate !== undefined ||
      data.cancellationPolicy !== undefined ||
      data.insuranceType !== undefined ||
      data.insuranceDetails !== undefined ||
      data.minimumAge !== undefined ||
      photoAdds.length > 0 ||
      Boolean(data.removePhotoPath);
    if (data.submitForHireReview) {
      if (current.status !== "approved")
        throw new Error("The vehicle must first be approved for driving.");
      const rate = data.dailyRate !== undefined ? data.dailyRate : current.hire_daily_rate;
      const photos = (patch["photo_urls"] as string[] | undefined) ?? [
        ...new Set([
          ...(current.photo_url ? [current.photo_url] : []),
          ...((current.photo_urls ?? []) as string[]),
        ]),
      ];
      if (!(Number(rate ?? 0) > 0))
        throw new Error("Set a daily hire price before requesting approval.");
      if (photos.length === 0)
        throw new Error("Add at least one vehicle photo before requesting approval.");
      patch["hire_approval_status"] = "pending";
      patch["hire_available"] = false;
      patch["hire_rejection_reason"] = null;
    } else if (listingChanged && current.hire_approval_status === "approved") {
      // The approved version is taken offline while materially edited details are reviewed.
      patch["hire_approval_status"] = "pending";
      patch["hire_available"] = false;
      patch["hire_rejection_reason"] = null;
    }

    if (data.hireAvailable !== undefined) {
      if (
        data.hireAvailable &&
        (current.status !== "approved" || current.hire_approval_status !== "approved")
      ) {
        throw new Error("Ops must approve this hire listing before it can be made available.");
      }
      patch["hire_available"] = data.hireAvailable;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("vehicles")
      .update(patch as never)
      .eq("id", data.vehicleId);
    if (error) throw new Error(error.message);
    if (data.removePhotoPath) {
      const { error: photoError } = await supabaseAdmin.storage
        .from("vehicle-photos")
        .remove([data.removePhotoPath]);
      if (photoError)
        throw new Error(`Photo removed from listing, but file cleanup failed: ${photoError.message}`);
    }
    if (patch["hire_approval_status"] === "pending") {
      await (await import("./links.server")).alertStaffVehicleSubmitted(data.vehicleId, "hire");
    }
    return {
      ok: true,
      submittedForReview: Boolean(data.submitForHireReview),
      cancellationPolicyAppliedToOwner: Boolean(data.applyCancellationPolicyToOwner),
    };
  });

export const submitHireQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["corporate", "car_hire"]).default("corporate"),
        vehicleId: z.string().uuid().nullable().optional(),
        organisation: z.string().max(120).optional(),
        contactName: z.string().max(120).optional(),
        contactPhone: z.string().max(20).optional(),
        contactEmail: z.string().email().max(160).optional().or(z.literal("")),
        vehicleClass: z.enum(VEHICLE_CLASSES),
        driveMode: z.enum(["self_drive", "chauffeured"]).default("chauffeured"),
        startAt: z.string().min(10).max(40),
        endAt: z.string().min(10).max(40),
        passengers: z.number().int().min(1).max(60).default(1),
        pickupLabel: z.string().min(2).max(200),
        pickupLat: z.number().min(-90).max(90).nullable().optional(),
        pickupLng: z.number().min(-180).max(180).nullable().optional(),
        stops: z.array(stopSchema).max(20).default([]),
        notes: z.string().max(1000).optional(),
        hirerType: z.enum(["individual", "company"]).default("individual"),
        renterName: z.string().max(120).optional(),
        renterIdNumber: z.string().max(40).optional(),
        idDocumentPath: z.string().max(400).optional(),
        licenseDocumentPath: z.string().max(400).optional(),
        rulesAccepted: z.boolean().optional(),
        initialPayment: z.enum(["full", "one_day"]).optional(),
        corporate: z
          .object({
            payLaterMethod: z.enum(["cheque", "bank_transfer", "mpesa", "invoice"]),
            payLaterDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            businessEmail: z.string().trim().email().max(160),
            registrationNumber: z.string().trim().max(60).optional(),
            businessAddress: z.string().trim().max(200).optional(),
            signerName: z.string().trim().min(3).max(120),
            signature: z.string().min(20).max(200_000),
          })
          .optional(),
        kycDocuments: z
          .array(
            z.object({
              kind: z.enum(["certificate", "kra_pin", "cr12", "other"]),
              path: z.string().min(1).max(400),
              remember: z.boolean().optional(),
            }),
          )
          .max(6)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const corporate = data.hirerType === "company" ? data.corporate : undefined;
    if (corporate) {
      const { isBusinessEmail } = await import("./hire-rules");
      if (!isBusinessEmail(corporate.businessEmail))
        throw new Error("Use a business email like name@company.co.ke.");
      const { data: verified } = await supabaseAdmin
        .from("business_email_otps")
        .select("id")
        .eq("user_id", context.userId)
        .eq("email", corporate.businessEmail.toLowerCase())
        .not("verified_at", "is", null)
        .gte("verified_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
        .limit(1);
      if (!verified?.length) throw new Error("Verify the business email with the code we sent first.");
      if (new Date(corporate.payLaterDueDate).getTime() < Date.now() - 86_400_000)
        throw new Error("Choose a payment date from today onwards.");
      // Company KYC: at least one business document, uploaded now or saved earlier.
      const kycPaths = (data.kycDocuments ?? []).map((d) => d.path);
      for (const path of kycPaths) {
        if (!path.startsWith(`${context.userId}/biz-`) || path.includes(".."))
          throw new Error("Upload your business documents again.");
      }
      // Business documents are optional: companies add what they have and staff/owners review them.
    }
    for (const path of [data.idDocumentPath, data.licenseDocumentPath]) {
      if (path && !path.startsWith(`${context.userId}/`))
        throw new Error("Upload your documents again.");
    }
    if (!data.idDocumentPath) throw new Error("Upload a photo of your ID.");
    if (data.driveMode === "self_drive" && !data.licenseDocumentPath) {
      throw new Error("Upload your driving licence to drive the car yourself.");
    }
    if (data.vehicleId && !data.rulesAccepted) throw new Error("Please accept the owner's rules.");
    const startAt = new Date(data.startAt);
    if (Number.isNaN(startAt.getTime())) throw new Error("Choose a valid start date and time.");
    if (startAt.getTime() < Date.now() - 60_000)
      throw new Error("Choose a date and time in the future.");
    const endAt = new Date(data.endAt);
    if (Number.isNaN(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
      throw new Error("Return time must be after pickup time.");
    }
    const days = Math.ceil((endAt.getTime() - startAt.getTime()) / 86_400_000);
    if (days < 1 || days > 90) throw new Error("Hire duration must be between 1 and 90 days.");

    let dailyRate: number | null = null;
    let chauffeurDailyRate: number | null = null;
    let vehicleClass = data.vehicleClass;
    let paymentPolicy: HirePaymentPolicy | "legacy" = "legacy";
    let depositPolicy: "upfront" | "handover" | "none" = "none";
    let depositAmount = 0;
    if (data.vehicleId) {
      const { data: vehicle } = await supabaseAdmin
        .from("vehicles")
        .select(
          "id, vehicle_class, seats, hire_daily_rate, hire_chauffeur_daily_rate, hire_payment_policy, hire_deposit_policy, hire_deposit_amount, hire_pay_later_allowed, hire_mode, hire_available, hire_approval_status, status",
        )
        .eq("id", data.vehicleId)
        .maybeSingle();
      if (
        !vehicle ||
        !vehicle.hire_available ||
        vehicle.status !== "approved" ||
        vehicle.hire_approval_status !== "approved"
      ) {
        throw new Error("That car is no longer available for hire.");
      }
      if (vehicle.seats != null && data.passengers > Number(vehicle.seats)) {
        throw new Error(`This car has ${vehicle.seats} seats. Choose no more than that number of passengers.`);
      }
      const hireMode = vehicle.hire_mode ?? "both";
      if (hireMode !== "both" && hireMode !== data.driveMode) {
        throw new Error("That car is not listed for the selected hire type.");
      }
      if (corporate && !vehicle.hire_pay_later_allowed) {
        throw new Error(
          "This owner allows immediate payments only — please choose Pay now (M-PESA) to book this car.",
        );
      }
      const selectedStartDate = nairobiDateKey(startAt);
      const selectedEndDate = nairobiDateKey(new Date(endAt.getTime() - 1));
      const { data: offlineConflict, error: offlineConflictError } = await supabaseAdmin
        .from("hire_vehicle_blackouts")
        .select("id")
        .eq("vehicle_id", data.vehicleId)
        .lte("start_date", selectedEndDate)
        .gte("end_date", selectedStartDate)
        .limit(1);
      if (offlineConflictError) throw new Error(`Could not verify vehicle availability: ${offlineConflictError.message}`);
      if (offlineConflict?.length) {
        throw new Error("That car is unavailable for some of those dates. Choose another date to see the next available option.");
      }
      dailyRate = vehicle.hire_daily_rate == null ? null : Number(vehicle.hire_daily_rate);
      chauffeurDailyRate = Number(vehicle.hire_chauffeur_daily_rate ?? CHAUFFEUR_DAY_RATE);
      vehicleClass = vehicle.vehicle_class as VehicleClass;
      paymentPolicy = vehicle.hire_payment_policy === "full" ? "full" : "daily_flexible";
      const v = vehicle as unknown as { hire_deposit_policy?: string; hire_deposit_amount?: number };
      depositPolicy = v.hire_deposit_policy === "upfront" || v.hire_deposit_policy === "handover" ? v.hire_deposit_policy : "none";
      depositAmount = depositPolicy === "none" ? 0 : Math.max(0, Number(v.hire_deposit_amount ?? 0));
      const { assertVehicleHasNoLiveRide } = await import("./vehicle-hire-lock.server");
      await assertVehicleHasNoLiveRide(data.vehicleId, startAt);
    }

    const hireEstimate = estimateHireTotal({
      vehicleClass,
      driveMode: data.driveMode,
      days,
      stops: data.stops.length,
      dailyRate,
      chauffeurDailyRate,
    });
    // Upfront deposits are collected with the first booking payment; handover deposits are added at pickup.
    const upfrontDeposit = depositPolicy === "upfront" ? depositAmount : 0;
    const estimate = hireEstimate + upfrontDeposit;
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", context.userId)
      .maybeSingle();
    let paymentPhone: string | null = null;
    if (data.vehicleId && !corporate) {
      const rawPhone = data.contactPhone ?? profile?.phone ?? "";
      if (!rawPhone) throw new Error("Enter an M-Pesa phone number to pay for this booking.");
      paymentPhone = normaliseKenyanPhone(rawPhone);
    }
    const minimum = paymentPolicy === "daily_flexible" ? Math.ceil(hireEstimate / days) + upfrontDeposit : estimate;
    if (data.vehicleId && paymentPolicy === "full" && data.initialPayment === "one_day") {
      throw new Error("This vehicle requires full payment before the owner can see the booking.");
    }
    const initialPaymentAmount =
      paymentPolicy === "full" || data.initialPayment === "full" ? estimate : minimum;
    const commissionPercent = data.vehicleId
      ? await (await import("./hire-payments.server")).getHireCommissionPercent()
      : null;
    const holdUntil = data.vehicleId ? new Date(Date.now() + 60 * 60_000).toISOString() : null;

    const { data: row, error } = await supabaseAdmin
      .from("hire_quotes")
      .insert({
        requester_id: context.userId,
        kind: data.kind,
        vehicle_id: data.vehicleId ?? null,
        organisation: data.organisation ?? null,
        contact_name: data.contactName ?? data.renterName ?? null,
        contact_phone: paymentPhone ?? data.contactPhone ?? profile?.phone ?? null,
        contact_email: data.contactEmail || null,
        vehicle_class: vehicleClass,
        drive_mode: data.driveMode,
        start_at: startAt.toISOString(),
        days,
        passengers: data.passengers,
        pickup_label: data.pickupLabel,
        pickup_lat: data.pickupLat ?? null,
        pickup_lng: data.pickupLng ?? null,
        stops: data.stops as never,
        notes: data.notes ?? null,
        estimated_total: estimate,
        deposit_policy: depositPolicy,
        deposit_amount: depositAmount,
        end_at: endAt.toISOString(),
        hirer_type: data.hirerType,
        renter_name: data.renterName ?? null,
        renter_id_number: data.renterIdNumber ?? null,
        id_document_path: data.idDocumentPath ?? null,
        license_document_path: data.licenseDocumentPath ?? null,
        rules_accepted_at: data.rulesAccepted ? new Date().toISOString() : null,
        payment_policy: paymentPolicy,
        payment_status: data.vehicleId ? "pending" : "legacy",
        payment_paid_total: 0,
        payment_minimum_amount: data.vehicleId ? minimum : null,
        initial_payment_choice:
          data.vehicleId && !corporate
            ? paymentPolicy === "full"
              ? "full"
              : (data.initialPayment ?? "one_day")
            : null,
        payment_hold_expires_at: corporate ? null : holdUntil,
        lifecycle_state: corporate ? "submitted" : data.vehicleId ? "payment_pending" : "submitted",
        commission_percent_snapshot: commissionPercent,
        ...(corporate
          ? {
              // Pay-later bookings wait for the owner to verify the company's KYC;
              // the dates are blocked only once the owner confirms.
              status: "submitted",
              pay_later_method: corporate.payLaterMethod,
              pay_later_due_date: corporate.payLaterDueDate,
              business_email: corporate.businessEmail.toLowerCase(),
              business_email_verified_at: new Date().toISOString(),
              business_registration_number: corporate.registrationNumber ?? null,
              business_address: corporate.businessAddress ?? null,
              agreement_signer_name: corporate.signerName,
              agreement_signature: corporate.signature,
              agreement_signed_at: new Date().toISOString(),
              contact_email: corporate.businessEmail.toLowerCase(),
            }
          : {}),
      } as never)
      .select(
        "id, reference, estimated_total, status, payment_policy, payment_status, payment_minimum_amount",
      )
      .single();
    if (error) {
      if (error.message.includes("already booked")) {
        throw new Error(
          "This vehicle is already booked for some of those dates. Please choose other dates.",
        );
      }
      throw new Error(error.message);
    }
    const { recordHireEvent } = await import("./hire-lifecycle.server");
    await recordHireEvent({
      quoteId: row.id,
      toState: corporate ? "submitted" : data.vehicleId ? "payment_pending" : "submitted",
      eventType: "hire_submitted",
      actorId: context.userId,
      actorRole: "hirer",
      metadata: { vehicleId: data.vehicleId ?? null, corporate: Boolean(corporate) },
    });

    // Persist company KYC documents (and remember them for future hires when asked).
    if (corporate && data.kycDocuments?.length) {
      for (const doc of data.kycDocuments) {
        if (doc.remember === false) continue;
        await supabaseAdmin.from("business_kyc_documents").upsert(
          {
            user_id: context.userId,
            document_kind: doc.kind,
            file_path: doc.path,
            saved_for_future: true,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "user_id,document_kind" },
        );
      }
    }

    let payment: Awaited<
      ReturnType<typeof import("./hire-payments.server").startHirePayment>
    > | null = null;
    if (corporate && data.vehicleId) {
      const { notifyOwnerOfBooking } = await import("./hire-owner.server");
      await notifyOwnerOfBooking(
        row.id,
        `company pay-later booking — verify their documents, then confirm. They pay by ${corporate.payLaterMethod.replace("_", " ")} on ${corporate.payLaterDueDate}`,
      );
    } else if (data.vehicleId && paymentPhone) {
      try {
        const payments = await import("./hire-payments.server");
        payment = await payments.startHirePayment({
          quoteId: row.id,
          actorId: context.userId,
          amount: initialPaymentAmount,
          phone: paymentPhone,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The M-Pesa prompt could not be started.";
        await supabaseAdmin
          .from("hire_quotes")
          .update({ payment_status: "failed", payment_hold_expires_at: null })
          .eq("id", row.id);
        payment = { accepted: false, status: "failed", message, amount: initialPaymentAmount, intentId: "" };
      }
    }

    try {
      const { notify } = await import("./notifications.server");
      await notify({
        userId: context.userId,
        templateCode: data.vehicleId ? "hire_payment_started" : "hire_quote_submitted",
        title: data.vehicleId ? "Complete your hire payment" : "Quotation request received",
        body: data.vehicleId
          ? payment?.accepted
            ? `Request ${row.reference}: approve the M-Pesa prompt for KES ${initialPaymentAmount.toLocaleString("en-KE")}. The owner will see the booking after the required payment clears.`
            : `Request ${row.reference} was saved, but the M-Pesa prompt did not start. ${payment?.message ?? "Retry payment from Your requests."}`
          : `Request ${row.reference}: KES ${estimate.toLocaleString("en-KE")} for ${days} day(s). A provider will respond shortly.`,
        dedupeKey: `hire:${row.id}`,
        critical: Boolean(data.vehicleId),
      });
    } catch (notifyError) {
      console.error("hire quote notification failed", notifyError);
    }
    return { ...row, payment };
  });

/** Private reusable identity/licence paths, scoped to the signed-in hirer. */
export const getMyHireDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("hire_customer_documents")
      .select("document_kind, file_path")
      .eq("requester_id", context.userId);
    if (error) throw new Error(`Could not load saved hire documents: ${error.message}`);
    return {
      idDocumentPath: data?.find((document) => document.document_kind === "id")?.file_path ?? null,
      licenseDocumentPath:
        data?.find((document) => document.document_kind === "license")?.file_path ?? null,
    };
  });

/** Save only files that exist in this user's private hire-document folder. */
export const saveMyHireDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["id", "license"]),
        filePath: z.string().min(1).max(500),
        remember: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const prefix = `${context.userId}/${data.kind}-`;
    if (
      !data.filePath.startsWith(prefix) ||
      data.filePath.includes("..") ||
      data.filePath.includes("\\")
    ) {
      throw new Error("That document upload does not belong to your account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fileName = data.filePath.slice(context.userId.length + 1);
    const { data: files, error: storageError } = await supabaseAdmin.storage
      .from("hire-documents")
      .list(context.userId, { limit: 100, search: fileName });
    if (storageError) throw new Error(`Could not verify document upload: ${storageError.message}`);
    if (!files?.some((file) => file.name === fileName)) {
      throw new Error("The uploaded document could not be found. Please upload it again.");
    }
    if (data.remember === false) return { ok: true, filePath: data.filePath };
    const { error } = await supabaseAdmin.from("hire_customer_documents").upsert(
      {
        requester_id: context.userId,
        document_kind: data.kind,
        file_path: data.filePath,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "requester_id,document_kind" },
    );
    if (error) throw new Error(`Could not save document for future bookings: ${error.message}`);
    return { ok: true, filePath: data.filePath };
  });

/** Company KYC documents saved on the account for future hires. */
export const getMyBusinessKyc = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("business_kyc_documents")
      .select("document_kind, file_path, updated_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(`Could not load saved business documents: ${error.message}`);
    return (data ?? []) as Array<{ document_kind: string; file_path: string; updated_at: string }>;
  });

/** Save a company KYC upload (paths must live in this user's private folder). */
export const saveBusinessKycDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["certificate", "kra_pin", "cr12", "other"]),
        filePath: z.string().min(1).max(400),
        remember: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (
      !data.filePath.startsWith(`${context.userId}/biz-`) ||
      data.filePath.includes("..") ||
      data.filePath.includes("\\")
    ) {
      throw new Error("That document upload does not belong to your account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fileName = data.filePath.slice(context.userId.length + 1);
    const { data: files, error: storageError } = await supabaseAdmin.storage
      .from("hire-documents")
      .list(context.userId, { limit: 100, search: fileName });
    if (storageError) throw new Error(`Could not verify document upload: ${storageError.message}`);
    if (!files?.some((file) => file.name === fileName)) {
      throw new Error("The uploaded document could not be found. Please upload it again.");
    }
    if (data.remember === false) return { ok: true, filePath: data.filePath };
    const { data: existing } = await supabaseAdmin
      .from("business_kyc_documents")
      .select("file_path")
      .eq("user_id", context.userId)
      .eq("document_kind", data.kind)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("business_kyc_documents").upsert(
      {
        user_id: context.userId,
        document_kind: data.kind,
        file_path: data.filePath,
        saved_for_future: true,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id,document_kind" },
    );
    if (error) throw new Error(`Could not save business document: ${error.message}`);
    // Edit trail for admins: record the upload/replace (best-effort).
    try {
      await supabaseAdmin.from("business_kyc_edits").insert({
        user_id: context.userId,
        actor_id: context.userId,
        action: existing ? "document_replaced" : "document_uploaded",
        field: data.kind,
        old_value: existing?.file_path ?? null,
        new_value: data.filePath,
      });
    } catch {
      // Never block a document save on the audit trail.
    }
    return { ok: true, filePath: data.filePath };
  });

export const listMyHireQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Safety net: don't rely only on the gateway callback. Ask the gateway
    // directly about this customer's hire payments still waiting > 15s.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: waiting } = await supabaseAdmin
        .from("payment_intents")
        .select("provider_reference, created_at")
        .eq("customer_id", context.userId)
        .not("hire_quote_id", "is", null)
        .in("status", ["pending", "initiating", "awaiting_confirmation", "processing"])
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .limit(5);
      const due = (waiting ?? []).filter(
        (w) => w.provider_reference && Date.now() - new Date(w.created_at).getTime() > 15_000,
      );
      if (due.length) {
        const { getTransaction } = await import("./adapters/palpluss.server");
        const { applyGatewayTransaction } = await import("./payments.server");
        for (const w of due) {
          const tx = await getTransaction(w.provider_reference!);
          if (tx && tx.status !== "PENDING") await applyGatewayTransaction(tx);
        }
      }
    } catch (e) {
      console.error("hire payment status check failed", e);
    }
    const { data } = await context.supabase
      .from("hire_quotes")
      .select("*")
      .eq("requester_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(30);
    const quotes = data ?? [];
    if (quotes.length === 0) return [];
    const { data: offers } = await context.supabase
      .from("hire_offers")
      .select("*")
      .in(
        "quote_id",
        quotes.map((quote) => quote.id),
      )
      .order("price", { ascending: true });
    return quotes.map((quote) => ({
      ...quote,
      offers: (offers ?? []).filter((offer) => offer.quote_id === quote.id),
    }));
  });

/** Payment card poll: asks the gateway directly so a lost callback never leaves the hirer waiting. */
export const checkHirePaymentNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quoteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: quote } = await supabaseAdmin
      .from("hire_quotes")
      .select("id, requester_id, payment_status")
      .eq("id", data.quoteId)
      .maybeSingle();
    if (!quote || quote.requester_id !== context.userId) throw new Error("Booking not found.");
    const { data: intent } = await supabaseAdmin
      .from("payment_intents")
      .select("status, provider_reference, created_at")
      .eq("hire_quote_id", quote.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let status = String(intent?.status ?? quote.payment_status);
    if (
      intent?.provider_reference &&
      ["pending", "initiating", "awaiting_confirmation", "processing", "timed_out"].includes(status) &&
      Date.now() - new Date(intent.created_at).getTime() > 6_000
    ) {
      try {
        const { getTransaction } = await import("./adapters/palpluss.server");
        const { applyGatewayTransaction } = await import("./payments.server");
        const tx = await getTransaction(intent.provider_reference);
        if (tx && tx.status !== "PENDING") {
          await applyGatewayTransaction(tx);
          if (tx.status === "SUCCESS") status = "paid";
          else if (["FAILED", "CANCELLED"].includes(tx.status)) status = "failed";
        }
      } catch (e) {
        console.error("hire payment check failed", e);
      }
    }
    if (status === "paid") return "paid" as const;
    if (["failed", "cancelled"].includes(status)) return "failed" as const;
    return "pending" as const;
  });

/** Ops queue: every request, newest first. */
export const payHireBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quoteId: z.string().uuid(),
        amount: z.number().positive().optional(),
        phone: z.string().max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: quote } = await supabaseAdmin
      .from("hire_quotes")
      .select(
        "id, requester_id, contact_phone, estimated_total, quoted_total, days, payment_policy, payment_status, payment_paid_total, payment_minimum_amount, initial_payment_choice",
      )
      .eq("id", data.quoteId)
      .maybeSingle();
    if (!quote || quote.requester_id !== context.userId)
      throw new Error("That hire booking is not yours.");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", context.userId)
      .maybeSingle();
    const total = Number(quote.quoted_total ?? quote.estimated_total);
    const paid = Number(quote.payment_paid_total ?? 0);
    const minimum = Number(
      quote.payment_minimum_amount ?? Math.ceil(total / Math.max(1, quote.days)),
    );
    const amount =
      data.amount ??
      (quote.initial_payment_choice === "full" || quote.payment_policy === "full"
        ? total - paid
        : Math.min(total - paid, Math.max(1, minimum)));
    const phone = data.phone ?? quote.contact_phone ?? profile?.phone ?? "";
    const { startHirePayment } = await import("./hire-payments.server");
    return startHirePayment({ quoteId: quote.id, actorId: context.userId, amount, phone });
  });

export const requestHirePaymentReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quoteId: z.string().uuid(),
        amount: z.number().positive().optional(),
        channels: z
          .array(z.enum(["sms", "email", "whatsapp"]))
          .min(1)
          .max(3)
          .default(["sms", "email", "whatsapp"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: quote } = await supabaseAdmin
      .from("hire_quotes")
      .select(
        "id, reference, requester_id, vehicle_id, estimated_total, quoted_total, days, payment_policy, payment_status, payment_paid_total, payment_minimum_amount, payment_hold_expires_at, status, contact_phone, contact_email, pay_later_method",
      )
      .eq("id", data.quoteId)
      .maybeSingle();
    if (!quote?.vehicle_id || quote.payment_policy === "legacy" || quote.status !== "confirmed") {
      throw new Error("Only paid, confirmed car-hire bookings can be sent a payment reminder.");
    }
    // Pay-later company bookings can be reminded even before any payment (status "pending").
    const payLater = Boolean(quote.pay_later_method);
    if (!["partial"].includes(quote.payment_status) && !(payLater && quote.payment_status === "pending"))
      throw new Error("This hire booking has no outstanding installment.");
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id, owner_driver_id, fleet_id")
      .eq("id", quote.vehicle_id)
      .maybeSingle();
    if (!vehicle) throw new Error("Hire vehicle no longer exists.");
    const owns = vehicle.owner_driver_id === context.userId;
    const { data: mayDrive } = await supabaseAdmin.rpc("may_drive_vehicle", {
      _user_id: context.userId,
      _vehicle_id: vehicle.id,
    });
    let ownsFleet = false;
    if (!owns && vehicle.fleet_id) {
      const { data: fleetOwned } = await supabaseAdmin.rpc("owns_fleet", {
        _user_id: context.userId,
        _fleet_id: vehicle.fleet_id,
      });
      ownsFleet = Boolean(fleetOwned);
    }
    if (!owns && !ownsFleet && !mayDrive)
      throw new Error("You cannot request payment for this vehicle.");
    const total = Number(quote.quoted_total ?? quote.estimated_total);
    const paid = Number(quote.payment_paid_total ?? 0);
    const oneDay = Number(
      quote.payment_minimum_amount ?? Math.ceil(total / Math.max(1, quote.days)),
    );
    if (data.amount !== undefined && data.amount > total - paid) {
      throw new Error("Requested payment cannot exceed the remaining hire balance.");
    }
    const amount = Math.min(total - paid, Math.round(data.amount ?? oneDay));
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", quote.requester_id)
      .maybeSingle();
    const phone = quote.contact_phone ?? profile?.phone ?? "";
    if (!phone) throw new Error("The customer has no M-Pesa phone number on file.");
    const { startHirePayment, sendHirePaymentReminder } = await import("./hire-payments.server");
    const payment = await startHirePayment({
      quoteId: quote.id,
      actorId: context.userId,
      amount,
      phone,
    });
    if (!payment.accepted) return { ...payment, channels: {} };
    const reminders = await sendHirePaymentReminder({
      quote: quote as never,
      actorId: context.userId,
      amount,
      intentId: payment.intentId,
      channels: data.channels,
    });
    const { audit } = await import("./notifications.server");
    await audit(context.userId, "hire_payment_reminder_requested", "hire_quote", quote.id, {
      amount,
      intent_id: payment.intentId,
      channels: reminders.channels,
    });
    return { ...payment, ...reminders };
  });

export const getHireCommissionAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: setting }, { data: balances }] = await Promise.all([
      supabaseAdmin
        .from("system_settings")
        .select("value")
        .eq("key", "hire_commission_percent")
        .maybeSingle(),
      supabaseAdmin
        .from("hire_owner_balances")
        .select("gross_paid_total, platform_fee_total, owner_balance")
        .limit(5000),
    ]);
    const value = Number(setting?.value ?? 7);
    return {
      commissionPercent: Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 7,
      grossPaidTotal: (balances ?? []).reduce((sum, row) => sum + Number(row.gross_paid_total), 0),
      platformFeeTotal: (balances ?? []).reduce(
        (sum, row) => sum + Number(row.platform_fee_total),
        0,
      ),
      ownerBalanceTotal: (balances ?? []).reduce((sum, row) => sum + Number(row.owner_balance), 0),
    };
  });

export const updateHireCommissionPercent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ percent: z.number().min(0).max(100) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("system_settings").upsert(
      {
        key: "hire_commission_percent",
        value: data.percent as never,
        description:
          "Platform commission percentage applied to each new hire payment. Existing bookings retain their snapshot.",
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    const { audit } = await import("./notifications.server");
    await audit(
      context.userId,
      "hire_commission_updated",
      "system_setting",
      "hire_commission_percent",
      { percent: data.percent },
    );
    return { ok: true, percent: data.percent };
  });

type HireCarTotals = {
  gross_paid_total: number;
  platform_fee_total: number;
  owner_net_total: number;
  settlement_count: number;
};

/** Sum verified hire settlements by car without relying on generated joins. */
async function getHireCarSettlementTotals(vehicleIds: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ids = [...new Set(vehicleIds)];
  const byVehicle = new Map<string, HireCarTotals>(
    ids.map((id) => [
      id,
      { gross_paid_total: 0, platform_fee_total: 0, owner_net_total: 0, settlement_count: 0 },
    ]),
  );
  if (ids.length === 0) return byVehicle;

  const vehicleByQuote = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 100) {
    const pageIds = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin
        .from("hire_quotes")
        .select("id, vehicle_id")
        .in("vehicle_id", pageIds)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(`Could not load hire finance bookings: ${error.message}`);
      for (const row of data ?? []) {
        if (row.vehicle_id) vehicleByQuote.set(row.id, row.vehicle_id);
      }
      if ((data ?? []).length < 1000) break;
    }
  }

  const quoteIds = [...vehicleByQuote.keys()];
  for (let start = 0; start < quoteIds.length; start += 100) {
    const pageIds = quoteIds.slice(start, start + 100);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin
        .from("hire_payment_settlements")
        .select("hire_quote_id, gross_amount, platform_fee_amount, owner_net_amount")
        .in("hire_quote_id", pageIds)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(`Could not load hire settlement ledger: ${error.message}`);
      for (const row of data ?? []) {
        const vehicleId = vehicleByQuote.get(row.hire_quote_id);
        if (!vehicleId) continue;
        const totals = byVehicle.get(vehicleId)!;
        totals.gross_paid_total += Number(row.gross_amount);
        totals.platform_fee_total += Number(row.platform_fee_amount);
        totals.owner_net_total += Number(row.owner_net_amount);
        totals.settlement_count += 1;
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  return byVehicle;
}

/** Owner-facing hire wallet, car-by-car income and payout history. */
export const getMyHirePortfolioFinance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ from: z.string().datetime(), to: z.string().datetime() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets, error: fleetError } = await supabaseAdmin
      .from("fleets")
      .select("id")
      .eq("owner_id", context.userId);
    if (fleetError) throw new Error(fleetError.message);
    const fleetIds = (fleets ?? []).map((fleet) => fleet.id);
    const ownerFilter = fleetIds.length
      ? `owner_driver_id.eq.${context.userId},fleet_id.in.(${fleetIds.join(",")})`
      : `owner_driver_id.eq.${context.userId}`;
    const [vehicleResult, balanceResult, phoneResult, requestResult] = await Promise.all([
      supabaseAdmin
        .from("vehicles")
        .select(
          "id, plate_number, make, model, vehicle_class, status, hire_approval_status, hire_available, hire_daily_rate",
        )
        .or(ownerFilter)
        .neq("hire_approval_status", "not_submitted")
        .order("plate_number"),
      supabaseAdmin
        .from("hire_owner_balances")
        .select("gross_paid_total, platform_fee_total, owner_balance, paid_out_total, updated_at")
        .eq("owner_user_id", context.userId)
        .maybeSingle(),
      supabaseAdmin.from("profiles").select("phone").eq("id", context.userId).maybeSingle(),
      supabaseAdmin
        .from("hire_payout_requests")
        .select(
          "id, amount, payout_phone, status, review_note, payout_reference, requested_at, reviewed_at, paid_at",
        )
        .eq("owner_user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (vehicleResult.error) throw new Error(vehicleResult.error.message);
    if (balanceResult.error) throw new Error(balanceResult.error.message);
    if (phoneResult.error) throw new Error(phoneResult.error.message);
    if (requestResult.error) throw new Error(requestResult.error.message);
    const vehicles = vehicleResult.data ?? [];
    const totals = await getHireCarSettlementTotals(vehicles.map((vehicle) => vehicle.id));
    const requests = requestResult.data ?? [];
    let reservedPayoutTotal = 0;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin
        .from("hire_payout_requests")
        .select("amount")
        .eq("owner_user_id", context.userId)
        .in("status", ["requested", "approved"])
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      reservedPayoutTotal += (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
      if ((data ?? []).length < 1000) break;
    }
    const ownerBalance = balanceResult.data ?? {
      gross_paid_total: 0,
      platform_fee_total: 0,
      owner_balance: 0,
      paid_out_total: 0,
      updated_at: null,
    };
    const vehicleByQuote = new Map<string, string>();
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    for (let start = 0; start < vehicleIds.length; start += 100) {
      const pageIds = vehicleIds.slice(start, start + 100);
      for (let offset = 0; ; offset += 1000) {
        const { data: quotes, error } = await supabaseAdmin
          .from("hire_quotes")
          .select("id, vehicle_id")
          .in("vehicle_id", pageIds)
          .order("id")
          .range(offset, offset + 999);
        if (error) throw new Error(`Could not load hire finance bookings: ${error.message}`);
        for (const quote of quotes ?? []) if (quote.vehicle_id) vehicleByQuote.set(quote.id, quote.vehicle_id);
        if ((quotes ?? []).length < 1000) break;
      }
    }
    const settlementRows: Array<{ hire_quote_id: string; gross_amount: number; owner_net_amount: number; created_at: string }> = [];
    const quoteIds = [...vehicleByQuote.keys()];
    for (let start = 0; start < quoteIds.length; start += 100) {
      const pageIds = quoteIds.slice(start, start + 100);
      for (let offset = 0; ; offset += 1000) {
        const { data: rows, error } = await supabaseAdmin
          .from("hire_payment_settlements")
          .select("hire_quote_id, gross_amount, owner_net_amount, created_at")
          .in("hire_quote_id", pageIds)
          .gte("created_at", data.from)
          .lt("created_at", data.to)
          .order("created_at", { ascending: false })
          .range(offset, offset + 999);
        if (error) throw new Error(`Could not load hire earnings: ${error.message}`);
        settlementRows.push(...(rows ?? []));
        if ((rows ?? []).length < 1000) break;
      }
    }
    return {
      settlements: settlementRows.map((r) => ({
        vehicleId: vehicleByQuote.get(r.hire_quote_id) ?? "",
        gross: Number(r.gross_amount),
        net: Number(r.owner_net_amount),
        at: r.created_at,
      })),
      vehicles: vehicles.map((vehicle) => ({
        ...vehicle,
        finance: totals.get(vehicle.id) ?? {
          gross_paid_total: 0,
          platform_fee_total: 0,
          owner_net_total: 0,
          settlement_count: 0,
        },
      })),
      ownerBalance,
      availableBalance: Math.max(0, Number(ownerBalance.owner_balance) - reservedPayoutTotal),
      reservedPayoutTotal,
      payoutRequests: requests,
      profilePhone: phoneResult.data?.phone ?? "",
    };
  });

/** Finance/ops staff view of approved hire cars, income, owner wallets and payouts. */
export const getAdminHirePortfolioFinance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF, FINANCE } = await import("./authz.server");
    const roles = await requireRole(context.userId, STAFF);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const vehicles: Array<{
      id: string;
      plate_number: string;
      make: string | null;
      model: string | null;
      vehicle_class: string;
      status: string;
      hire_available: boolean;
      hire_daily_rate: number | null;
      owner_driver_id: string | null;
      fleet_id: string | null;
    }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin
        .from("vehicles")
        .select(
          "id, plate_number, make, model, vehicle_class, status, hire_available, hire_daily_rate, owner_driver_id, fleet_id",
        )
        .eq("status", "approved")
        .eq("hire_approval_status", "approved")
        .order("plate_number")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(`Could not load approved hire cars: ${error.message}`);
      vehicles.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }

    const fleetIds = [
      ...new Set(vehicles.flatMap((vehicle) => (vehicle.fleet_id ? [vehicle.fleet_id] : []))),
    ];
    const fleets: Array<{ id: string; owner_id: string; business_name: string }> = [];
    for (let start = 0; start < fleetIds.length; start += 100) {
      const { data, error } = await supabaseAdmin
        .from("fleets")
        .select("id, owner_id, business_name")
        .in("id", fleetIds.slice(start, start + 100));
      if (error) throw new Error(`Could not load hire owner accounts: ${error.message}`);
      fleets.push(...(data ?? []));
    }
    const fleetById = new Map(fleets.map((fleet) => [fleet.id, fleet]));
    const ownerIds = [
      ...new Set(
        vehicles
          .map(
            (vehicle) =>
              vehicle.owner_driver_id ??
              (vehicle.fleet_id ? fleetById.get(vehicle.fleet_id)?.owner_id : null),
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const profiles: Array<{ id: string; full_name: string | null; phone: string | null }> = [];
    const balances: Array<{
      owner_user_id: string;
      gross_paid_total: number;
      platform_fee_total: number;
      owner_balance: number;
      paid_out_total: number;
    }> = [];
    for (let start = 0; start < ownerIds.length; start += 100) {
      const pageIds = ownerIds.slice(start, start + 100);
      const [
        { data: profileRows, error: profileError },
        { data: balanceRows, error: balanceError },
      ] = await Promise.all([
        supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", pageIds),
        supabaseAdmin
          .from("hire_owner_balances")
          .select(
            "owner_user_id, gross_paid_total, platform_fee_total, owner_balance, paid_out_total",
          )
          .in("owner_user_id", pageIds),
      ]);
      if (profileError) throw new Error(profileError.message);
      if (balanceError) throw new Error(balanceError.message);
      profiles.push(...(profileRows ?? []));
      balances.push(...(balanceRows ?? []));
    }
    const ownerBalanceById = new Map(balances.map((balance) => [balance.owner_user_id, balance]));
    const payoutReservedByOwner = new Map<string, number>();
    const payoutRequests: Array<{
      id: string;
      owner_user_id: string;
      amount: number;
      payout_phone: string;
      status: string;
      review_note: string | null;
      payout_reference: string | null;
      requested_at: string;
      reviewed_at: string | null;
      paid_at: string | null;
    }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin
        .from("hire_payout_requests")
        .select(
          "id, owner_user_id, amount, payout_phone, status, review_note, payout_reference, requested_at, reviewed_at, paid_at",
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(`Could not load hire payout requests: ${error.message}`);
      payoutRequests.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    for (const request of payoutRequests) {
      if (request.status === "requested" || request.status === "approved") {
        payoutReservedByOwner.set(
          request.owner_user_id,
          (payoutReservedByOwner.get(request.owner_user_id) ?? 0) + Number(request.amount),
        );
      }
    }
    const knownProfileIds = new Set(profiles.map((profile) => profile.id));
    const payoutOwnerIds = [
      ...new Set(payoutRequests.map((request) => request.owner_user_id)),
    ].filter((ownerId) => !knownProfileIds.has(ownerId));
    for (let start = 0; start < payoutOwnerIds.length; start += 100) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", payoutOwnerIds.slice(start, start + 100));
      if (error) throw new Error(`Could not load payout owner profiles: ${error.message}`);
      profiles.push(...(data ?? []));
    }
    const systemBalances: Array<{
      gross_paid_total: number;
      platform_fee_total: number;
      owner_balance: number;
      paid_out_total: number;
    }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin
        .from("hire_owner_balances")
        .select("gross_paid_total, platform_fee_total, owner_balance, paid_out_total")
        .order("owner_user_id")
        .range(offset, offset + 999);
      if (error) throw new Error(`Could not load hire wallet totals: ${error.message}`);
      systemBalances.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const settlementTotals = await getHireCarSettlementTotals(
      vehicles.map((vehicle) => vehicle.id),
    );
    const financeVehicles = vehicles.map((vehicle) => {
      const ownerId =
        vehicle.owner_driver_id ??
        (vehicle.fleet_id ? (fleetById.get(vehicle.fleet_id)?.owner_id ?? null) : null);
      const profile = ownerId ? profileById.get(ownerId) : null;
      const fleet = vehicle.fleet_id ? fleetById.get(vehicle.fleet_id) : null;
      const balance = ownerId ? ownerBalanceById.get(ownerId) : null;
      const reserved = ownerId ? (payoutReservedByOwner.get(ownerId) ?? 0) : 0;
      return {
        ...vehicle,
        owner_user_id: ownerId,
        owner_name: fleet?.business_name ?? profile?.full_name ?? "Unknown hire owner",
        owner_phone: profile?.phone ?? null,
        owner_gross_paid_total: Number(balance?.gross_paid_total ?? 0),
        owner_platform_fee_total: Number(balance?.platform_fee_total ?? 0),
        owner_wallet_balance: Number(balance?.owner_balance ?? 0),
        owner_paid_out_total: Number(balance?.paid_out_total ?? 0),
        owner_reserved_payout_total: reserved,
        owner_available_balance: Math.max(0, Number(balance?.owner_balance ?? 0) - reserved),
        finance: settlementTotals.get(vehicle.id) ?? {
          gross_paid_total: 0,
          platform_fee_total: 0,
          owner_net_total: 0,
          settlement_count: 0,
        },
      };
    });
    const profileForOwner = new Map(profiles.map((profile) => [profile.id, profile]));
    return {
      vehicles: financeVehicles,
      payoutRequests: payoutRequests.map((request) => ({
        ...request,
        owner_name: profileForOwner.get(request.owner_user_id)?.full_name ?? "Hire owner",
        owner_phone: profileForOwner.get(request.owner_user_id)?.phone ?? null,
      })),
      totals: {
        grossPaidTotal: systemBalances.reduce(
          (sum, balance) => sum + Number(balance.gross_paid_total),
          0,
        ),
        platformFeeTotal: systemBalances.reduce(
          (sum, balance) => sum + Number(balance.platform_fee_total),
          0,
        ),
        ownerWalletTotal: systemBalances.reduce(
          (sum, balance) => sum + Number(balance.owner_balance),
          0,
        ),
        paidOutTotal: systemBalances.reduce(
          (sum, balance) => sum + Number(balance.paid_out_total),
          0,
        ),
        reservedPayoutTotal: [...payoutReservedByOwner.values()].reduce(
          (sum, value) => sum + value,
          0,
        ),
      },
      canReviewPayouts: roles.some((role) => FINANCE.includes(role)),
    };
  });

/** Owners can request a manual payout from their available hire wallet balance. */
export const requestHirePayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        amount: z.number().positive().max(10_000_000),
        payoutPhone: z.string().min(6).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { normaliseKenyanPhone } = await import("./phone");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phone = normaliseKenyanPhone(data.payoutPhone);
    const { data: result, error } = await supabaseAdmin.rpc("request_hire_payout", {
      p_owner_user_id: context.userId,
      p_amount: data.amount,
      p_payout_phone: phone,
    });
    if (error) throw new Error(error.message);
    const payload = result as { request_id?: string; amount?: number; available_balance?: number };
    if (!payload.request_id) throw new Error("The hire payout request could not be recorded.");
    try {
      const { audit } = await import("./notifications.server");
      await audit(
        context.userId,
        "hire_payout_requested",
        "hire_payout_request",
        payload.request_id,
        {
          amount: payload.amount ?? data.amount,
          payout_phone: phone,
        },
      );
    } catch (auditError) {
      console.error("hire payout request audit failed", auditError);
    }
    try {
      const { textStaffWithLink } = await import("./links.server");
      await textStaffWithLink(["ops_admin", "finance_admin", "super_admin"], {
        message: `Twende: new hire payout request for KES ${Math.round(Number(payload.amount ?? data.amount)).toLocaleString("en-KE")}. Review urgently:`,
        path: "/admin/finance",
        eventType: "hire_payout_request_staff_alert",
        idempotencyKey: `hire-payout-staff:${payload.request_id}`,
      });
    } catch (staffAlertError) {
      console.error("hire payout staff SMS failed", staffAlertError);
    }
    await smsPayoutSummary(context.userId, `payout-req:${payload.request_id}`, "Payout request received.", Number(payload.amount ?? data.amount));
    return {
      requestId: payload.request_id,
      amount: payload.amount ?? data.amount,
      availableBalance: payload.available_balance ?? 0,
    };
  });

/** Text the owner a payout summary: requested, paid out, balance. */
async function smsPayoutSummary(ownerId: string, key: string, headline: string, requested: number) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: bal }, { data: prof }, { data: open }] = await Promise.all([
      supabaseAdmin.from("hire_owner_balances").select("owner_balance, paid_out_total").eq("owner_user_id", ownerId).maybeSingle(),
      supabaseAdmin.from("profiles").select("phone").eq("id", ownerId).maybeSingle(),
      supabaseAdmin.from("hire_payout_requests").select("amount").eq("owner_user_id", ownerId).in("status", ["requested", "approved"]),
    ]);
    if (!prof?.phone) return;
    const pending = (open ?? []).reduce((a, r) => a + Number(r.amount), 0);
    const balance = Number(bal?.owner_balance ?? 0);
    const k = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
    const { sendTransactionalSms } = await import("./comms.server");
    await sendTransactionalSms({
      to: prof.phone,
      eventType: "hire_payout_summary",
      idempotencyKey: key,
      message: `Twende: ${headline} Requested: ${k(requested)}. Total paid to you: ${k(Number(bal?.paid_out_total ?? 0))}. Pending: ${k(pending)}. Balance available: ${k(Math.max(0, balance - pending))}. Statement: https://twenderide8.lovable.app/driver/hire?section=finances`,
    });
  } catch (e) {
    console.error("payout sms failed", e);
  }
}

/** Finance staff approves/rejects requests or records a completed manual transfer. */
export const reviewHirePayoutRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "paid", "rejected"]),
        note: z.string().max(400).optional(),
        payoutReference: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, FINANCE } = await import("./authz.server");
    await requireRole(context.userId, FINANCE);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("review_hire_payout_request", {
      p_request_id: data.id,
      p_decision: data.decision,
      p_reviewer_id: context.userId,
      ...(data.note?.trim() ? { p_note: data.note.trim() } : {}),
      ...(data.payoutReference?.trim() ? { p_payout_reference: data.payoutReference.trim() } : {}),
    });
    if (error) throw new Error(error.message);
    const payload = result as {
      owner_user_id?: string;
      amount?: number;
      status?: string;
      payout_reference?: string | null;
    };
    if (!payload.owner_user_id) throw new Error("The hire payout review could not be recorded.");
    try {
      const { audit } = await import("./notifications.server");
      await audit(context.userId, `hire_payout_${data.decision}`, "hire_payout_request", data.id, {
        amount: payload.amount,
        payout_reference: payload.payout_reference ?? null,
        note: data.note ?? null,
      });
    } catch (auditError) {
      console.error("hire payout review audit failed", auditError);
    }
    try {
      const { notify } = await import("./notifications.server");
      const messages = {
        approved:
          "Your hire payout request has been approved. Finance will send it to your requested M-Pesa number.",
        paid: `Your hire payout was marked paid. Reference: ${payload.payout_reference ?? data.payoutReference ?? "recorded by Finance"}.`,
        rejected: `Your hire payout request was declined.${data.note?.trim() ? ` Finance note: ${data.note.trim()}` : ""}`,
      };
      await notify({
        userId: payload.owner_user_id,
        templateCode: `hire_payout_${data.decision}`,
        title: `Hire payout ${data.decision}`,
        body: messages[data.decision],
        critical: true,
        dedupeKey: `hire-payout:${data.id}:${data.decision}`,
      });
    } catch (notifyError) {
      console.error("hire payout status notification failed", notifyError);
    }
    await smsPayoutSummary(
      payload.owner_user_id,
      `payout-${data.decision}:${data.id}`,
      { approved: "Payout approved.", paid: `Payout sent${payload.payout_reference ? ` (ref ${payload.payout_reference})` : ""}.`, rejected: "Payout request declined." }[data.decision],
      Number(payload.amount ?? 0),
    );
    return { ok: true, status: payload.status ?? data.decision };
  });

export const listHireQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("hire_quotes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

export const decideHireQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["submitted", "quoted", "confirmed", "declined"]),
        quotedTotal: z.number().min(0).max(10_000_000).nullable().optional(),
        adminNotes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: current } = await supabaseAdmin
      .from("hire_quotes")
      .select("vehicle_id, payment_policy")
      .eq("id", data.id)
      .maybeSingle();
    if (current?.vehicle_id && current.payment_policy !== "legacy") {
      throw new Error(
        "Listed-car bookings use the published price and verified payment flow; they cannot be repriced here.",
      );
    }
    const { data: row, error } = await supabaseAdmin
      .from("hire_quotes")
      .update({
        status: data.status,
        quoted_total: data.quotedTotal ?? null,
        admin_notes: data.adminNotes ?? null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select("id, reference, requester_id, quoted_total, status")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { notify, audit } = await import("./notifications.server");
      await audit(context.userId, "hire_quote_decided", "hire_quote", data.id, {
        status: data.status,
      });
      const price =
        row.quoted_total == null ? null : Number(row.quoted_total).toLocaleString("en-KE");
      await notify({
        userId: row.requester_id,
        templateCode: `hire_quote_${data.status}`,
        title: data.status === "declined" ? "Quotation update" : "Your quotation is ready",
        body:
          data.status === "declined"
            ? `Request ${row.reference} could not be fulfilled. ${data.adminNotes ?? ""}`.trim()
            : `Request ${row.reference}: KES ${price ?? "—"}. ${data.adminNotes ?? ""}`.trim(),
        dedupeKey: `hire:${row.id}:${data.status}`,
        critical: true,
      });
    } catch (notifyError) {
      console.error("hire decision notification failed", notifyError);
    }
    return { ok: true };
  });

/**
 * Drivers and owners see the hire requests they can actually serve: open
 * requests for a class of vehicle they operate, plus the offers they made.
 */
export const listHireRequestsForProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets } = await context.supabase
      .from("fleets")
      .select("id")
      .eq("owner_id", context.userId);
    const fleetIds = (fleets ?? []).map((fleet) => fleet.id);
    const { data: owned } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate_number, vehicle_class, hire_daily_rate, status")
      .or(
        fleetIds.length
          ? `owner_driver_id.eq.${context.userId},fleet_id.in.(${fleetIds.join(",")})`
          : `owner_driver_id.eq.${context.userId}`,
      );
    const { data: authorised } = await supabaseAdmin
      .from("driver_vehicle_authorisations")
      .select("vehicle_id, vehicles(id, plate_number, vehicle_class, hire_daily_rate, status)")
      .eq("driver_id", context.userId)
      .is("revoked_at", null);
    const vehicles = [
      ...(owned ?? []),
      ...((authorised ?? [])
        .map((row) => (row as { vehicles?: unknown }).vehicles)
        .filter(Boolean) as Array<{
        id: string;
        plate_number: string;
        vehicle_class: string;
        hire_daily_rate: number | null;
        status: string;
      }>),
    ].filter((vehicle, index, list) => list.findIndex((item) => item.id === vehicle.id) === index);
    const classes = [
      ...new Set(vehicles.map((vehicle) => vehicle.vehicle_class)),
    ] as VehicleClass[];
    const { data: ownerBalance } = await supabaseAdmin
      .from("hire_owner_balances")
      .select("gross_paid_total, platform_fee_total, owner_balance")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (classes.length === 0) return { vehicles: [], requests: [], owner_balance: ownerBalance };

    const { data: allRequests } = await supabaseAdmin
      .from("hire_quotes")
      .select("*")
      .in("status", ["submitted", "quoted", "confirmed"])
      .in("vehicle_class", classes)
      .order("start_at", { ascending: true })
      .limit(100);
    const ownIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const requests = (allRequests ?? []).filter((request) => {
      if (!request.vehicle_id) return ["submitted", "quoted"].includes(request.status);
      if (!ownIds.has(request.vehicle_id)) return false;
      if (request.payment_policy === "legacy")
        return ["submitted", "quoted", "confirmed"].includes(request.status);
      return request.status === "confirmed" && ["partial", "paid"].includes(request.payment_status);
    });
    const ids = requests.map((request) => request.id);
    const [{ data: offers }, { data: settlements }] = await Promise.all([
      ids.length
        ? supabaseAdmin.from("hire_offers").select("*").in("quote_id", ids)
        : Promise.resolve({ data: [] as never[] }),
      ids.length
        ? supabaseAdmin
            .from("hire_payment_settlements")
            .select("hire_quote_id, gross_amount, platform_fee_amount, owner_net_amount")
            .in("hire_quote_id", ids)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const settlementTotals = new Map<string, { gross: number; fee: number; net: number }>();
    for (const settlement of settlements ?? []) {
      const current = settlementTotals.get(settlement.hire_quote_id) ?? {
        gross: 0,
        fee: 0,
        net: 0,
      };
      current.gross += Number(settlement.gross_amount);
      current.fee += Number(settlement.platform_fee_amount);
      current.net += Number(settlement.owner_net_amount);
      settlementTotals.set(settlement.hire_quote_id, current);
    }

    const docPaths = requests
      .filter((request) => request.vehicle_id && ownIds.has(request.vehicle_id))
      .flatMap((request) => [request.id_document_path, request.license_document_path])
      .filter((value): value is string => Boolean(value));
    const { data: signed } = docPaths.length
      ? await supabaseAdmin.storage.from("hire-documents").createSignedUrls(docPaths, 1800)
      : { data: [] as Array<{ path: string | null; signedUrl: string }> };
    const docLinks = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
    return {
      vehicles,
      owner_balance: ownerBalance ?? {
        gross_paid_total: 0,
        platform_fee_total: 0,
        owner_balance: 0,
      },
      requests: requests.map((request) => ({
        ...request,
        id_document_link: request.id_document_path
          ? (docLinks.get(request.id_document_path) ?? null)
          : null,
        license_document_link: request.license_document_path
          ? (docLinks.get(request.license_document_path) ?? null)
          : null,
        offers: (offers ?? []).filter((offer) => offer.quote_id === request.id),
        my_offer: (offers ?? []).find(
          (offer) => offer.quote_id === request.id && offer.responder_id === context.userId,
        ),
        settlement_totals: settlementTotals.get(request.id) ?? { gross: 0, fee: 0, net: 0 },
      })),
    };
  });

/** A driver or owner offers to run the hire at a price. */
export const makeHireOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quoteId: z.string().uuid(),
        vehicleId: z.string().uuid(),
        price: z.number().min(0).max(10_000_000),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id, owner_driver_id, fleet_id, status, hire_hourly_available")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (!vehicle || vehicle.status !== "approved") throw new Error("That vehicle is not approved.");

    const owns = vehicle.owner_driver_id === context.userId;
    const { data: mayDrive } = await supabaseAdmin.rpc("may_drive_vehicle", {
      _user_id: context.userId,
      _vehicle_id: data.vehicleId,
    });
    let ownsFleet = false;
    if (!owns && vehicle.fleet_id) {
      const { data: fleetOwned } = await supabaseAdmin.rpc("owns_fleet", {
        _user_id: context.userId,
        _fleet_id: vehicle.fleet_id,
      });
      ownsFleet = Boolean(fleetOwned);
    }
    if (!owns && !ownsFleet && !mayDrive) throw new Error("You cannot offer this vehicle.");

    const { data: quote } = await supabaseAdmin
      .from("hire_quotes")
      .select("id, reference, requester_id, status, vehicle_id, payment_policy")
      .eq("id", data.quoteId)
      .maybeSingle();
    if (!quote || !["submitted", "quoted"].includes(quote.status)) {
      throw new Error("This request is already closed.");
    }
    const hourly = (quote as typeof quote & { service_type?: string; vehicle_id?: string | null }).service_type === "hourly_charter";
    if (hourly && (quote.vehicle_id !== data.vehicleId || !(vehicle as typeof vehicle & { hire_hourly_available?: boolean }).hire_hourly_available))
      throw new Error("This hourly request is tied to the selected hourly-enabled car.");
    if (quote.vehicle_id && quote.payment_policy !== "legacy") {
      throw new Error("Listed-car bookings are pay-first and cannot receive competing offers.");
    }

    const { error } = await supabaseAdmin.from("hire_offers").upsert(
      {
        quote_id: data.quoteId,
        responder_id: context.userId,
        vehicle_id: data.vehicleId,
        price: data.price,
        note: data.note ?? null,
        status: "offered",
        counter_price: null,
        counter_note: null,
      } as never,
      { onConflict: "quote_id,responder_id" },
    );
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("hire_quotes").update({ status: "quoted" }).eq("id", data.quoteId);

    try {
      const { notify } = await import("./notifications.server");
      await notify({
        userId: quote.requester_id,
        templateCode: "hire_offer_received",
        title: "You have a hire offer",
        body: `Request ${quote.reference}: an owner offered KES ${data.price.toLocaleString("en-KE")}. Open Hire to accept or decline.`,
        dedupeKey: `hire-offer:${data.quoteId}:${context.userId}:${data.price}`,
        critical: true,
      });
    } catch (notifyError) {
      console.error("hire offer notification failed", notifyError);
    }
    return { ok: true };
  });

/** The customer accepts one offer, or declines it so others can bid. */
export const respondToHireOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ offerId: z.string().uuid(), action: z.enum(["accept", "decline", "counter"]), counterPrice: z.number().positive().max(10_000_000).optional(), counterNote: z.string().trim().max(400).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: offer } = await supabaseAdmin
      .from("hire_offers")
      .select("id, quote_id, responder_id, vehicle_id, price, status")
      .eq("id", data.offerId)
      .maybeSingle();
    if (!offer) throw new Error("That offer no longer exists.");

    const { data: quote } = await supabaseAdmin
      .from("hire_quotes")
      .select("id, reference, requester_id, status, start_at, service_type")
      .eq("id", offer.quote_id)
      .maybeSingle();
    if (!quote || quote.requester_id !== context.userId) throw new Error("Not your request.");

    if (data.action === "counter") {
      if ((quote as typeof quote & { service_type?: string }).service_type !== "hourly_charter" || !data.counterPrice)
        throw new Error("Counteroffers are available for hourly charter requests only. Enter a positive price.");
      if (offer.status !== "offered") throw new Error("This offer is no longer open for a counteroffer.");
      const { error } = await supabaseAdmin.from("hire_offers").update({ counter_price: data.counterPrice, counter_note: data.counterNote ?? null } as never).eq("id", offer.id);
      if (error) throw new Error(error.message);
      try {
        const { notify } = await import("./notifications.server");
        await notify({ userId: offer.responder_id, templateCode: "hire_offer_received", title: "Customer counteroffer", body: `Request ${quote.reference}: the customer proposed KES ${data.counterPrice.toLocaleString("en-KE")}. Review it in Hire requests.`, dedupeKey: `hire-counter:${offer.id}:${data.counterPrice}`, critical: true });
      } catch (error) { console.error("hourly counteroffer notification failed", error); }
      return { ok: true, countered: true };
    }
    if (data.action === "decline") {
      await supabaseAdmin.from("hire_offers").update({ status: "declined" }).eq("id", offer.id);
      const { count } = await supabaseAdmin
        .from("hire_offers")
        .select("id", { count: "exact", head: true })
        .eq("quote_id", offer.quote_id)
        .eq("status", "offered");
      if (!count) {
        await supabaseAdmin
          .from("hire_quotes")
          .update({ status: "submitted" })
          .eq("id", offer.quote_id);
      }
    } else {
      if (offer.vehicle_id) {
        const { assertVehicleHasNoLiveRide } = await import("./vehicle-hire-lock.server");
        await assertVehicleHasNoLiveRide(offer.vehicle_id, new Date(quote.start_at));
      }
      const isHourly = (quote as typeof quote & { service_type?: string }).service_type === "hourly_charter";
      const hourlyCommission = isHourly
        ? await (await import("./hire-payments.server")).getHireCommissionPercent()
        : null;
      const { error: acceptError } = await supabaseAdmin.rpc("accept_hire_offer", {
        p_offer_id: offer.id,
        p_requester_id: context.userId,
        ...(hourlyCommission === null ? {} : { p_commission_percent: hourlyCommission }),
      });
      if (acceptError) throw new Error(acceptError.message);
    }

    try {
      const { notify } = await import("./notifications.server");
      await notify({
        userId: offer.responder_id,
        templateCode: `hire_offer_${data.action}ed`,
        title: data.action === "accept" ? "Your hire offer was accepted" : "Hire offer declined",
        body:
          data.action === "accept"
            ? `Request ${quote.reference} is yours at KES ${Number(offer.price).toLocaleString("en-KE")}.`
            : `Request ${quote.reference}: the customer declined your price. It is open to other owners.`,
        dedupeKey: `hire-offer:${offer.id}:${data.action}`,
        critical: true,
      });
    } catch (notifyError) {
      console.error("hire offer response notification failed", notifyError);
    }
    return { ok: true };
  });

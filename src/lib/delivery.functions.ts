import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { routeThroughStops } from "./rides.functions";

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(400).optional().nullable(),
});
const vehicleClass = z.enum(["boda", "e_boda", "go", "plus", "comfort", "xl"]);

/** Current fleet, submitted rate card, and the driver's eligible fleet vehicles. */
export const getMyDeliveryBusiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fleets } = await supabaseAdmin
      .from("fleets")
      .select("*")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1);
    const fleet = fleets?.[0] ?? null;
    const vehicleFilter = fleet
      ? `owner_driver_id.eq.${context.userId},fleet_id.eq.${fleet.id}`
      : `owner_driver_id.eq.${context.userId}`;
    const { data: vehicles } = await supabaseAdmin
      .from("vehicles")
      .select(
        "id, plate_number, make, model, colour, vehicle_class, status, fleet_id, photo_url, photo_urls",
      )
      .or(vehicleFilter)
      .order("created_at", { ascending: false });
    const proposals = fleet?.id
      ? await supabaseAdmin
          .from("fleet_delivery_rate_proposals")
          .select("*")
          .eq("fleet_id", fleet.id)
          .order("submitted_at", { ascending: false })
          .limit(5)
      : { data: [] };
    const proposal = proposals.data?.[0] ?? null;
    return { fleet, vehicles: vehicles ?? [], latestRateProposal: proposal };
  });

/** Submit a delivery-business application and proposed rates; publication remains gated on Ops approval. */
export const submitDeliveryBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        businessName: z.string().trim().min(2).max(120),
        registrationNumber: z.string().trim().max(80).optional().nullable(),
        contactPhone: z.string().trim().max(24).optional().nullable(),
        contactEmail: z.string().trim().email().max(160).optional().nullable(),
        baseFee: z.number().min(0).max(100000),
        perKm: z.number().min(0).max(100000),
        perMinute: z.number().min(0).max(100000),
        minimumFee: z.number().min(0).max(100000),
        vehicleIds: z.array(z.string().uuid()).max(50).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existingRows } = await supabaseAdmin
      .from("fleets")
      .select("*")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1);
    let fleet = existingRows?.[0] ?? null;
    let rateProposalPending = false;
    if (fleet) {
      const { data: pendingProposal } = await supabaseAdmin
        .from("fleet_delivery_rate_proposals")
        .select("id")
        .eq("fleet_id", fleet.id)
        .eq("status", "pending")
        .maybeSingle();
      rateProposalPending = Boolean(pendingProposal);
      const { data: updated, error } = await supabaseAdmin
        .from("fleets")
        .update({
          delivery_business_name: data.businessName,
          registration_number: data.registrationNumber ?? null,
          contact_phone: data.contactPhone ?? null,
          contact_email: data.contactEmail ?? null,
          delivery_enabled: true,
          delivery_rate_status: fleet.delivery_rate_status === "approved" ? "approved" : "pending",
        })
        .eq("id", fleet.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      fleet = updated;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("fleets")
        .insert({
          owner_id: context.userId,
          business_name: data.businessName,
          delivery_business_name: data.businessName,
          registration_number: data.registrationNumber ?? null,
          contact_phone: data.contactPhone ?? null,
          contact_email: data.contactEmail ?? null,
          status: "pending",
          settlement_mode: "fleet_wallet",
          driver_split_percent: 0,
          cash_commission_liability: "fleet",
          delivery_enabled: true,
          delivery_rate_status: "pending",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      fleet = created;
    }

    if (data.vehicleIds.length) {
      const { data: selectedVehicles } = await supabaseAdmin
        .from("vehicles")
        .select("id, owner_driver_id, fleet_id, status")
        .in("id", data.vehicleIds)
        .or(`owner_driver_id.eq.${context.userId},fleet_id.eq.${fleet.id}`);
      if ((selectedVehicles ?? []).length !== new Set(data.vehicleIds).size)
        throw new Error("Select only vehicles you own or vehicles already assigned to your fleet.");
      if (
        (selectedVehicles ?? []).some(
          (vehicle) =>
            vehicle.status !== "approved" || (vehicle.fleet_id && vehicle.fleet_id !== fleet.id),
        )
      ) {
        throw new Error(
          "Only approved vehicles that are not assigned to another fleet can be added.",
        );
      }
      const { error } = await supabaseAdmin
        .from("vehicles")
        .update({ fleet_id: fleet.id })
        .in("id", data.vehicleIds);
      if (error) throw new Error(error.message);
    }

    if (!rateProposalPending) {
      const { error: proposalError } = await supabaseAdmin
        .from("fleet_delivery_rate_proposals")
        .insert({
          fleet_id: fleet.id,
          base_fee: data.baseFee,
          per_km: data.perKm,
          per_minute: data.perMinute,
          minimum_fee: data.minimumFee,
          submitted_by: context.userId,
          status: "pending",
        });
      if (proposalError) throw new Error(proposalError.message);
    }
    return {
      fleetId: fleet.id,
      fleetStatus: fleet.status,
      rateStatus: fleet.delivery_rate_status,
      pendingRateProposal: rateProposalPending,
    };
  });

export interface NearbyDeliveryVehicle {
  id: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  vehicleClass: string;
  distanceKm: number;
  etaMinutes: number;
  photoUrl: string | null;
}

export interface DeliveryOption {
  fleetId: string;
  businessName: string;
  feeEstimate: number;
  baseFee: number;
  distanceFee: number;
  timeFee: number;
  distanceKm: number;
  durationMinutes: number;
  availableVehicles: NearbyDeliveryVehicle[];
}

/** Route-calculated company rates plus a short anonymous list of nearby available vehicles. */
export const getDeliveryOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pickup: point,
        dropoff: point,
        stops: z.array(point).max(4).optional().default([]),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{ distanceKm: number; durationMinutes: number; options: DeliveryOption[] }> => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { haversineKm } = await import("./geo");
      const { activeHireWindows } = await import("./vehicle-hire-lock.server");
      const route = await routeThroughStops([data.pickup, ...(data.stops ?? []), data.dropoff]);
      if (route.distance_km <= 0)
        throw new Error("Pickup and destination are too close to price a delivery.");
      const { data: fleets } = await supabaseAdmin
        .from("fleets")
        .select(
          "id, business_name, delivery_business_name, delivery_base_fee, delivery_per_km, delivery_per_minute, delivery_minimum_fee",
        )
        .eq("status", "approved")
        .eq("delivery_enabled", true)
        .eq("delivery_rate_status", "approved");
      if (!fleets?.length)
        return {
          distanceKm: route.distance_km,
          durationMinutes: route.duration_minutes,
          options: [],
        };
      const fleetIds = fleets.map((fleet) => fleet.id);
      const { data: vehicles } = await supabaseAdmin
        .from("vehicles")
        .select("id, fleet_id, vehicle_class, make, model, colour, photo_url, photo_urls, status")
        .in("fleet_id", fleetIds)
        .eq("status", "approved");
      const vehicleIds = (vehicles ?? []).map((vehicle) => vehicle.id);
      if (!vehicleIds.length)
        return {
          distanceKm: route.distance_km,
          durationMinutes: route.duration_minutes,
          options: [],
        };
      const { data: drivers } = await supabaseAdmin
        .from("drivers")
        .select("id, active_vehicle_id, last_lat, last_lng, last_location_at")
        .eq("is_online", true)
        .eq("status", "approved")
        .in("active_vehicle_id", vehicleIds);
      const driverVehicleIds = (drivers ?? [])
        .map((driver) => driver.active_vehicle_id)
        .filter((id): id is string => Boolean(id));
      const { data: busyRides } = driverVehicleIds.length
        ? await supabaseAdmin
            .from("rides")
            .select("driver_id")
            .in("status", ["driver_assigned", "driver_arriving", "driver_arrived", "trip_started"])
            .in(
              "driver_id",
              (drivers ?? []).map((driver) => driver.id),
            )
        : { data: [] };
      const busyDrivers = new Set((busyRides ?? []).map((ride) => ride.driver_id).filter(Boolean));
      const rented = new Set(
        (await activeHireWindows(vehicleIds)).map((window) => window.vehicle_id),
      );
      const vehicleById = new Map((vehicles ?? []).map((vehicle) => [vehicle.id, vehicle]));
      const now = Date.now();
      const photos = [
        ...new Set(
          (vehicles ?? [])
            .flatMap((vehicle) => [vehicle.photo_url, ...(vehicle.photo_urls ?? [])])
            .filter((path): path is string => Boolean(path)),
        ),
      ];
      const signed = photos.length
        ? await supabaseAdmin.storage.from("vehicle-photos").createSignedUrls(photos, 1800)
        : { data: [] };
      const photoMap = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
      const byFleet = new Map<string, NearbyDeliveryVehicle[]>();
      for (const driver of drivers ?? []) {
        if (
          busyDrivers.has(driver.id) ||
          !driver.active_vehicle_id ||
          rented.has(driver.active_vehicle_id)
        )
          continue;
        if (driver.last_lat == null || driver.last_lng == null) continue;
        if (
          driver.last_location_at &&
          now - new Date(driver.last_location_at).getTime() > 10 * 60_000
        )
          continue;
        const vehicle = vehicleById.get(driver.active_vehicle_id);
        if (!vehicle?.fleet_id) continue;
        const distance = haversineKm(data.pickup, {
          lat: Number(driver.last_lat),
          lng: Number(driver.last_lng),
        });
        if (distance > 5) continue;
        const photoPath = vehicle.photo_url ?? vehicle.photo_urls?.[0] ?? null;
        const list = byFleet.get(vehicle.fleet_id) ?? [];
        list.push({
          id: vehicle.id,
          make: vehicle.make,
          model: vehicle.model,
          colour: vehicle.colour,
          vehicleClass: vehicle.vehicle_class,
          distanceKm: Number(distance.toFixed(1)),
          etaMinutes: Math.max(1, Math.ceil(distance * 2.8 + 1)),
          photoUrl: photoPath ? (photoMap.get(photoPath) ?? null) : null,
        });
        byFleet.set(vehicle.fleet_id, list);
      }

      const options = fleets
        .flatMap((fleet) => {
          const availableVehicles = (byFleet.get(fleet.id) ?? [])
            .sort((a, b) => a.etaMinutes - b.etaMinutes)
            .slice(0, 6);
          if (!availableVehicles.length) return [];
          const baseFee = Number(fleet.delivery_base_fee ?? 0);
          const distanceFee = Number(
            (route.distance_km * Number(fleet.delivery_per_km ?? 0)).toFixed(2),
          );
          const timeFee = Number(
            (route.duration_minutes * Number(fleet.delivery_per_minute ?? 0)).toFixed(2),
          );
          const feeEstimate = Number(
            Math.max(
              Number(fleet.delivery_minimum_fee ?? 0),
              baseFee + distanceFee + timeFee,
            ).toFixed(2),
          );
          return [
            {
              fleetId: fleet.id,
              businessName: fleet.delivery_business_name ?? fleet.business_name,
              feeEstimate,
              baseFee,
              distanceFee,
              timeFee,
              distanceKm: route.distance_km,
              durationMinutes: route.duration_minutes,
              availableVehicles,
            },
          ];
        })
        .sort((a, b) => a.feeEstimate - b.feeEstimate);
      return { distanceKm: route.distance_km, durationMinutes: route.duration_minutes, options };
    },
  );

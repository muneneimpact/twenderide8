import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateCompliance, type ComplianceDocument } from "./compliance";

const PAGE_SIZE = 1000;

export const getAdminHireVehicleListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, OPS } = await import("./authz.server");
    await requireRole(context.userId, OPS);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    type VehicleRow = {
      id: string;
      plate_number: string;
      make: string | null;
      model: string | null;
      colour: string | null;
      year: number | null;
      seats: number | null;
      vehicle_class: string;
      status: string;
      owner_driver_id: string | null;
      fleet_id: string | null;
      hire_mode: string | null;
      hire_payment_policy: string | null;
      hire_daily_rate: number | null;
      hire_description: string | null;
      hire_features: string | null;
      hire_rules: string | null;
      hire_notes: string | null;
      hire_available: boolean;
      hire_approval_status: string;
      hire_rejection_reason: string | null;
      photo_url: string | null;
      photo_urls: string[] | null;
      created_at: string;
    };

    const allVehicles: VehicleRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("vehicles")
        .select(
          "id, plate_number, make, model, colour, year, seats, vehicle_class, status, owner_driver_id, fleet_id, hire_mode, hire_payment_policy, hire_daily_rate, hire_description, hire_features, hire_rules, hire_notes, hire_available, hire_approval_status, hire_rejection_reason, photo_url, photo_urls, created_at",
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`Could not load hire inventory: ${error.message}`);
      allVehicles.push(...((data ?? []) as unknown as VehicleRow[]));
      if ((data ?? []).length < PAGE_SIZE) break;
    }

    const vehicles = allVehicles.filter(
      (vehicle) =>
        vehicle.hire_approval_status !== "not_submitted" ||
        vehicle.hire_available ||
        Number(vehicle.hire_daily_rate ?? 0) > 0 ||
        Boolean(vehicle.hire_description || vehicle.hire_features || vehicle.hire_rules),
    );
    const fleetIds = [
      ...new Set(vehicles.flatMap((vehicle) => (vehicle.fleet_id ? [vehicle.fleet_id] : []))),
    ];
    const fleets: Array<{ id: string; owner_id: string; business_name: string }> = [];
    for (let start = 0; start < fleetIds.length; start += 100) {
      const { data, error } = await supabaseAdmin
        .from("fleets")
        .select("id, owner_id, business_name")
        .in("id", fleetIds.slice(start, start + 100));
      if (error) throw new Error(`Could not load hire owner businesses: ${error.message}`);
      fleets.push(...(data ?? []));
    }
    const fleetById = new Map(fleets.map((fleet) => [fleet.id, fleet]));
    const ownerIds = [
      ...new Set(
        vehicles
          .map(
            (vehicle) =>
              vehicle.owner_driver_id ??
              (vehicle.fleet_id ? (fleetById.get(vehicle.fleet_id)?.owner_id ?? null) : null),
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const profiles: Array<{ id: string; full_name: string | null; phone: string | null }> = [];
    const driverIds = new Set<string>();
    for (let start = 0; start < ownerIds.length; start += 100) {
      const ids = ownerIds.slice(start, start + 100);
      const [{ data: profileRows, error: profileError }, { data: driverRows, error: driverError }] =
        await Promise.all([
          supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", ids),
          supabaseAdmin.from("drivers").select("id").in("id", ids),
        ]);
      if (profileError) throw new Error(`Could not load hire owners: ${profileError.message}`);
      if (driverError)
        throw new Error(`Could not load hire driver records: ${driverError.message}`);
      profiles.push(...(profileRows ?? []));
      for (const driver of driverRows ?? []) driverIds.add(driver.id);
    }
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    const { data: typeRows, error: typeError } = await supabaseAdmin
      .from("document_types")
      .select("id, code, label, applies_to, required, expires, requires_image")
      .eq("active", true);
    if (typeError)
      throw new Error(`Could not load compliance document types: ${typeError.message}`);
    const documentTypes = typeRows ?? [];

    type DocumentRow = ComplianceDocument & {
      id: string;
      reference: string | null;
      file_path: string | null;
      rejection_reason: string | null;
    };
    const documentMap = new Map<string, DocumentRow>();
    const fetchDocuments = async (
      field: "subject_user_id" | "subject_vehicle_id",
      ids: string[],
    ) => {
      for (let start = 0; start < ids.length; start += 100) {
        const chunk = ids.slice(start, start + 100);
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { data, error } = await supabaseAdmin
            .from("documents")
            .select(
              "id, document_type_id, subject_user_id, subject_vehicle_id, status, expires_on, created_at, reference, file_path, rejection_reason",
            )
            .in(field, chunk)
            .order("created_at", { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
          if (error) throw new Error(`Could not load hire compliance documents: ${error.message}`);
          for (const row of data ?? []) documentMap.set(row.id, row as DocumentRow);
          if ((data ?? []).length < PAGE_SIZE) break;
        }
      }
    };
    await Promise.all([
      fetchDocuments("subject_user_id", ownerIds),
      fetchDocuments(
        "subject_vehicle_id",
        vehicles.map((vehicle) => vehicle.id),
      ),
    ]);
    const documents = [...documentMap.values()];

    const signPaths = async (bucket: string, paths: string[]) => {
      const links = new Map<string, string>();
      const uniquePaths = [...new Set(paths.filter(Boolean))];
      for (let start = 0; start < uniquePaths.length; start += 100) {
        const { data, error } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrls(uniquePaths.slice(start, start + 100), 1800);
        if (error) throw new Error(`Could not open hire ${bucket} files: ${error.message}`);
        for (const item of data ?? []) {
          if (item.path && item.signedUrl) links.set(item.path, item.signedUrl);
        }
      }
      return links;
    };
    const [photoLinks, documentLinks] = await Promise.all([
      signPaths(
        "vehicle-photos",
        vehicles
          .flatMap((vehicle) => [vehicle.photo_url, ...(vehicle.photo_urls ?? [])])
          .filter((path): path is string => Boolean(path)),
      ),
      signPaths(
        "driver-documents",
        documents.flatMap((document) => (document.file_path ? [document.file_path] : [])),
      ),
    ]);
    const typeById = new Map(documentTypes.map((type) => [type.id, type]));

    return {
      vehicles: vehicles.map((vehicle) => {
        const ownerId =
          vehicle.owner_driver_id ??
          (vehicle.fleet_id ? (fleetById.get(vehicle.fleet_id)?.owner_id ?? null) : null);
        const profile = ownerId ? profileById.get(ownerId) : null;
        const fleet = vehicle.fleet_id ? fleetById.get(vehicle.fleet_id) : null;
        const relevantDocuments = documents
          .filter(
            (document) =>
              document.subject_vehicle_id === vehicle.id ||
              (Boolean(ownerId) && document.subject_user_id === ownerId),
          )
          .sort(
            (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
          );
        const compliance = evaluateCompliance({
          documentTypes,
          documents: relevantDocuments,
          userId: ownerId,
          vehicleId: vehicle.id,
          includeDriver: driverIds.has(ownerId ?? ""),
          includeVehicle: true,
        });
        const uniquePhotoPaths = [
          ...new Set(
            [vehicle.photo_url, ...(vehicle.photo_urls ?? [])].filter((path): path is string =>
              Boolean(path),
            ),
          ),
        ];
        return {
          ...vehicle,
          owner_user_id: ownerId,
          owner_name: fleet?.business_name ?? profile?.full_name ?? "Unknown hire owner",
          owner_phone: profile?.phone ?? null,
          photo_links: uniquePhotoPaths
            .map((path) => photoLinks.get(path))
            .filter((url): url is string => Boolean(url)),
          compliance,
          documents: relevantDocuments.map((document) => ({
            id: document.id,
            label: typeById.get(document.document_type_id)?.label ?? "Compliance document",
            applies_to: typeById.get(document.document_type_id)?.applies_to ?? "driver",
            expires: typeById.get(document.document_type_id)?.expires ?? false,
            status: document.status,
            reference: document.reference,
            expires_on: document.expires_on,
            rejection_reason: document.rejection_reason,
            file_link: document.file_path ? (documentLinks.get(document.file_path) ?? null) : null,
          })),
        };
      }),
      requiredDocuments: documentTypes.filter((type) => type.required).map((type) => type.label),
    };
  });

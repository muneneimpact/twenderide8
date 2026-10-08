export type ComplianceDocumentType = {
  id: string;
  label: string;
  applies_to: string;
  required: boolean;
  expires: boolean;
};

export type ComplianceDocument = {
  id?: string;
  document_type_id: string;
  subject_user_id?: string | null;
  subject_vehicle_id?: string | null;
  status: string;
  expires_on: string | null;
  created_at?: string;
};

export type ComplianceItemStatus =
  "approved" | "missing" | "pending" | "rejected" | "expired" | "missing_expiry";

export type ComplianceItem = {
  documentTypeId: string;
  label: string;
  status: ComplianceItemStatus;
  expiresOn: string | null;
};

export type ComplianceSummary = {
  compliant: boolean;
  requiredCount: number;
  items: ComplianceItem[];
};

export function complianceTodayInKenya(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * A document counts only after Operations approves it. For expiring document
 * types, an expiry date is mandatory and the document stops counting on that date.
 * Hire compliance includes owner identity documents, driver credentials when the
 * owner has a driver account, and required documents attached to the vehicle.
 */
export function evaluateCompliance(input: {
  documentTypes: ComplianceDocumentType[];
  documents: ComplianceDocument[];
  userId: string | null;
  vehicleId?: string | null;
  includeDriver?: boolean;
  includeOwner?: boolean;
  includeVehicle?: boolean;
  today?: string;
}): ComplianceSummary {
  const {
    documentTypes,
    documents,
    userId,
    vehicleId = null,
    includeDriver = true,
    includeOwner = true,
    includeVehicle = Boolean(vehicleId),
    today = complianceTodayInKenya(),
  } = input;

  const requiredTypes = documentTypes.filter(
    (type) =>
      type.required &&
      ((type.applies_to === "driver" && includeDriver) ||
        (type.applies_to === "owner" && includeOwner) ||
        (type.applies_to === "vehicle" && includeVehicle && Boolean(vehicleId))),
  );

  const items = requiredTypes.map((type): ComplianceItem => {
    const matching = documents
      .filter((document) => {
        if (document.document_type_id !== type.id) return false;
        if (type.applies_to === "driver" || type.applies_to === "owner") {
          return (
            Boolean(userId) && document.subject_user_id === userId && !document.subject_vehicle_id
          );
        }
        return Boolean(vehicleId) && document.subject_vehicle_id === vehicleId;
      })
      .sort(
        (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
      );

    const validApproved = matching.find(
      (document) =>
        document.status === "approved" &&
        (!type.expires || Boolean(document.expires_on && document.expires_on >= today)),
    );
    if (validApproved) {
      return {
        documentTypeId: type.id,
        label: type.label,
        status: "approved",
        expiresOn: validApproved.expires_on,
      };
    }

    const latest = matching[0];
    if (!latest) {
      return { documentTypeId: type.id, label: type.label, status: "missing", expiresOn: null };
    }
    if (latest.status === "approved" && type.expires && !latest.expires_on) {
      return {
        documentTypeId: type.id,
        label: type.label,
        status: "missing_expiry",
        expiresOn: null,
      };
    }
    if (
      latest.status === "approved" &&
      type.expires &&
      latest.expires_on !== null &&
      latest.expires_on < today
    ) {
      return {
        documentTypeId: type.id,
        label: type.label,
        status: "expired",
        expiresOn: latest.expires_on,
      };
    }
    return {
      documentTypeId: type.id,
      label: type.label,
      status: latest.status === "rejected" ? "rejected" : "pending",
      expiresOn: latest.expires_on,
    };
  });

  return {
    compliant: items.length > 0 && items.every((item) => item.status === "approved"),
    requiredCount: requiredTypes.length,
    items,
  };
}

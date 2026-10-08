ALTER TABLE public.document_types DROP CONSTRAINT IF EXISTS document_types_applies_to;
ALTER TABLE public.document_types ADD CONSTRAINT document_types_applies_to CHECK (applies_to = ANY (ARRAY['driver','fleet','vehicle','customer','owner']));
-- Standardize compliance document types used by driver and hire-vehicle workflows.
-- Logbook and roadworthiness inspection are available but optional for now.
WITH desired(code, label, applies_to, required, requires_image, expires, reminder_days, active) AS (
  VALUES
    ('driving_licence', 'Driving licence', 'driver', true, true, true, 30, true),
    ('psv_licence', 'PSV licence', 'driver', true, true, true, 30, true),
    ('identity_document', 'National ID / Passport', 'owner', true, true, false, 30, true),
    ('vehicle_logbook', 'Vehicle ownership (logbook)', 'vehicle', false, true, false, 30, true),
    ('vehicle_insurance', 'Vehicle insurance', 'vehicle', true, true, true, 30, true),
    ('vehicle_inspection_certificate', 'Vehicle inspection / roadworthiness certificate', 'vehicle', false, true, true, 30, true)
)
INSERT INTO public.document_types
  (code, label, applies_to, required, requires_image, expires, reminder_days, active)
SELECT desired.code, desired.label, desired.applies_to, desired.required,
       desired.requires_image, desired.expires, desired.reminder_days, desired.active
FROM desired
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_types existing WHERE existing.code = desired.code
);

WITH desired(code, label, applies_to, required, requires_image, expires, reminder_days, active) AS (
  VALUES
    ('driving_licence', 'Driving licence', 'driver', true, true, true, 30, true),
    ('psv_licence', 'PSV licence', 'driver', true, true, true, 30, true),
    ('identity_document', 'National ID / Passport', 'owner', true, true, false, 30, true),
    ('vehicle_logbook', 'Vehicle ownership (logbook)', 'vehicle', false, true, false, 30, true),
    ('vehicle_insurance', 'Vehicle insurance', 'vehicle', true, true, true, 30, true),
    ('vehicle_inspection_certificate', 'Vehicle inspection / roadworthiness certificate', 'vehicle', false, true, true, 30, true)
)
UPDATE public.document_types target
SET label = desired.label,
    applies_to = desired.applies_to,
    required = desired.required,
    requires_image = desired.requires_image,
    expires = desired.expires,
    reminder_days = desired.reminder_days,
    active = desired.active
FROM desired
WHERE target.code = desired.code;

-- Move existing records from common legacy code/label variants to the canonical
-- types before hiding those legacy choices. This preserves already submitted docs.
WITH aliases(legacy_key, canonical_code) AS (
  VALUES
    ('drivinglicence', 'driving_licence'),
    ('drivinglicense', 'driving_licence'),
    ('driverlicence', 'driving_licence'),
    ('driverlicense', 'driving_licence'),
    ('driverslicense', 'driving_licence'),
    ('psv', 'psv_licence'),
    ('psvlicence', 'psv_licence'),
    ('psvlicense', 'psv_licence'),
    ('publicservicevehiclelicence', 'psv_licence'),
    ('publicservicevehiclelicense', 'psv_licence'),
    ('nationalid', 'identity_document'),
    ('nationalidentity', 'identity_document'),
    ('passport', 'identity_document'),
    ('idpassport', 'identity_document'),
    ('identitydocument', 'identity_document'),
    ('logbook', 'vehicle_logbook'),
    ('vehiclelogbook', 'vehicle_logbook'),
    ('carownership', 'vehicle_logbook'),
    ('vehicleownership', 'vehicle_logbook'),
    ('insurance', 'vehicle_insurance'),
    ('vehicleinsurance', 'vehicle_insurance'),
    ('carinsurance', 'vehicle_insurance'),
    ('motorvehicleinsurance', 'vehicle_insurance'),
    ('roadworthiness', 'vehicle_inspection_certificate'),
    ('vehicleinspection', 'vehicle_inspection_certificate'),
    ('inspectioncertificate', 'vehicle_inspection_certificate')
)
UPDATE public.documents document
SET document_type_id = canonical.id
FROM public.document_types legacy,
     public.document_types canonical,
     aliases
WHERE document.document_type_id = legacy.id
  AND canonical.code = aliases.canonical_code
  AND legacy.id <> canonical.id
  AND (
    regexp_replace(lower(legacy.code), '[^a-z0-9]+', '', 'g') = aliases.legacy_key
    OR regexp_replace(lower(legacy.label), '[^a-z0-9]+', '', 'g') = aliases.legacy_key
  );

WITH aliases(legacy_key, canonical_code) AS (
  VALUES
    ('drivinglicence', 'driving_licence'),
    ('drivinglicense', 'driving_licence'),
    ('driverlicence', 'driving_licence'),
    ('driverlicense', 'driving_licence'),
    ('driverslicense', 'driving_licence'),
    ('psv', 'psv_licence'),
    ('psvlicence', 'psv_licence'),
    ('psvlicense', 'psv_licence'),
    ('publicservicevehiclelicence', 'psv_licence'),
    ('publicservicevehiclelicense', 'psv_licence'),
    ('nationalid', 'identity_document'),
    ('nationalidentity', 'identity_document'),
    ('passport', 'identity_document'),
    ('idpassport', 'identity_document'),
    ('identitydocument', 'identity_document'),
    ('logbook', 'vehicle_logbook'),
    ('vehiclelogbook', 'vehicle_logbook'),
    ('carownership', 'vehicle_logbook'),
    ('vehicleownership', 'vehicle_logbook'),
    ('insurance', 'vehicle_insurance'),
    ('vehicleinsurance', 'vehicle_insurance'),
    ('carinsurance', 'vehicle_insurance'),
    ('motorvehicleinsurance', 'vehicle_insurance'),
    ('roadworthiness', 'vehicle_inspection_certificate'),
    ('vehicleinspection', 'vehicle_inspection_certificate'),
    ('inspectioncertificate', 'vehicle_inspection_certificate')
)
UPDATE public.document_types legacy
SET active = false,
    required = false
FROM aliases
WHERE legacy.code NOT IN (
    'driving_licence', 'psv_licence', 'identity_document',
    'vehicle_logbook', 'vehicle_insurance', 'vehicle_inspection_certificate'
  )
  AND (
    regexp_replace(lower(legacy.code), '[^a-z0-9]+', '', 'g') = aliases.legacy_key
    OR regexp_replace(lower(legacy.label), '[^a-z0-9]+', '', 'g') = aliases.legacy_key
  );

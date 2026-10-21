ALTER TABLE public.notification_preferences ALTER COLUMN whatsapp_enabled SET DEFAULT true;
ALTER TABLE public.notification_preferences ALTER COLUMN whatsapp_opted_in_at SET DEFAULT now();
ALTER TABLE public.notification_preferences ALTER COLUMN whatsapp_opt_in_source SET DEFAULT 'default_opt_in';

INSERT INTO public.document_types (code, label, applies_to, required, expires, reminder_days, active, requires_image) VALUES
 ('national_id', 'National ID / Passport', 'driver', true, false, 14, true, true),
 ('driving_licence', 'Driving licence', 'driver', true, true, 14, true, true),
 ('psv_licence', 'PSV badge / licence', 'driver', true, true, 14, true, true),
 ('good_conduct', 'Certificate of good conduct', 'driver', true, true, 14, true, true),
 ('driver_kra_pin', 'KRA PIN certificate', 'driver', false, false, 14, true, true),
 ('vehicle_logbook', 'Vehicle logbook', 'vehicle', true, false, 14, true, true),
 ('vehicle_insurance', 'Commercial (PSV) insurance', 'vehicle', true, true, 14, true, true),
 ('ntsa_inspection', 'NTSA inspection certificate', 'vehicle', true, true, 14, true, true),
 ('psv_vehicle_licence', 'PSV vehicle licence', 'vehicle', true, true, 14, true, true)
ON CONFLICT (code) DO UPDATE SET active = true;
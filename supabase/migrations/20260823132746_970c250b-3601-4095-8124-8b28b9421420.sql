INSERT INTO public.document_types (code, label, applies_to, required, expires, reminder_days, active) VALUES
  ('national_id', 'National ID number', 'driver', true, false, 30, true),
  ('driving_licence', 'Driving licence', 'driver', true, true, 30, true),
  ('psv_badge', 'PSV badge', 'driver', false, true, 30, true),
  ('good_conduct', 'Certificate of good conduct', 'driver', false, true, 60, true),
  ('vehicle_logbook', 'Vehicle logbook', 'vehicle', true, false, 30, true),
  ('vehicle_insurance', 'Vehicle insurance certificate', 'vehicle', true, true, 21, true),
  ('vehicle_inspection', 'Vehicle inspection certificate', 'vehicle', false, true, 21, true),
  ('fleet_registration', 'Business registration certificate', 'fleet', true, false, 30, true)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, applies_to = EXCLUDED.applies_to, required = EXCLUDED.required, expires = EXCLUDED.expires, active = true;
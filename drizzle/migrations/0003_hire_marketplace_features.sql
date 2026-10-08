ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_features text;

COMMENT ON COLUMN public.vehicles.hire_features IS
  'Owner-entered customer-facing hire features, verified by Ops during listing inspection.';

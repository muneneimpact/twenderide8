ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS return_odometer numeric,
  ADD COLUMN IF NOT EXISTS return_fuel_level text,
  ADD COLUMN IF NOT EXISTS return_fuel_missing_percent numeric,
  ADD COLUMN IF NOT EXISTS return_excess_km_waived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_fuel_waived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hire_quotes.return_odometer IS 'Owner-verified odometer reading at return; distance driven is calculated against pickup inspection.';
COMMENT ON COLUMN public.hire_quotes.return_fuel_level IS 'Owner-verified return fuel gauge level.';
COMMENT ON COLUMN public.hire_quotes.return_fuel_missing_percent IS 'Calculated fuel-gauge shortfall in percentage points against pickup level.';
COMMENT ON COLUMN public.hire_quotes.return_excess_km_waived IS 'Owner agreed not to charge excess mileage for this return.';
COMMENT ON COLUMN public.hire_quotes.return_fuel_waived IS 'Owner agreed not to charge for missing fuel for this return.';

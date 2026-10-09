ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_cancellation_policy text NOT NULL DEFAULT 'Submit cancellation requests through Twende Meru Rides. Any refund or deduction is subject to platform review; do not settle cancellations off-platform.',
  ADD COLUMN IF NOT EXISTS hire_insurance_type text,
  ADD COLUMN IF NOT EXISTS hire_insurance_details text,
  ADD COLUMN IF NOT EXISTS hire_minimum_age smallint,
  ADD COLUMN IF NOT EXISTS hire_chauffeur_daily_rate numeric(10, 2) NOT NULL DEFAULT 2500 CHECK (hire_chauffeur_daily_rate >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_hire_insurance_type_check'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_hire_insurance_type_check
      CHECK (hire_insurance_type IS NULL OR hire_insurance_type IN (
        'comprehensive', 'third_party_fire_theft', 'third_party_only', 'other'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_hire_minimum_age_check'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_hire_minimum_age_check
      CHECK (hire_minimum_age IS NULL OR hire_minimum_age BETWEEN 18 AND 100);
  END IF;
END $$;

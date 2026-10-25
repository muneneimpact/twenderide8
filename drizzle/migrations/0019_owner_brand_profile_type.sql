ALTER TABLE public.hire_owner_brands
  ADD COLUMN IF NOT EXISTS profile_type text NOT NULL DEFAULT 'person';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hire_owner_brands_profile_type_check'
      AND conrelid = 'public.hire_owner_brands'::regclass
  ) THEN
    ALTER TABLE public.hire_owner_brands
      ADD CONSTRAINT hire_owner_brands_profile_type_check
      CHECK (profile_type IN ('person', 'company'));
  END IF;
END $$;

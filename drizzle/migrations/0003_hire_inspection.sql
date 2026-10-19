ALTER TABLE public.hire_quotes ADD COLUMN IF NOT EXISTS inspection_photos jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.hire_quotes ADD COLUMN IF NOT EXISTS inspection_at timestamptz;
ALTER TABLE public.hire_quotes ADD COLUMN IF NOT EXISTS inspection_odometer integer;
ALTER TABLE public.hire_quotes ADD COLUMN IF NOT EXISTS inspection_fuel text;
ALTER TABLE public.hire_quotes ADD COLUMN IF NOT EXISTS inspection_notes text;
ALTER TABLE public.hire_quotes ADD COLUMN IF NOT EXISTS agreement_emailed_at timestamptz;
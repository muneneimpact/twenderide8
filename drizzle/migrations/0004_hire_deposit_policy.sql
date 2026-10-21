ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_deposit_policy text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS hire_deposit_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_hire_deposit_policy_chk CHECK (hire_deposit_policy IN ('upfront','handover','none'));
ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS deposit_policy text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_requested_at timestamptz;
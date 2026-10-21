ALTER TABLE public.route_quotes
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_phone text;
ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS return_deposit_held numeric,
  ADD COLUMN IF NOT EXISTS return_km_driven numeric,
  ADD COLUMN IF NOT EXISTS return_excess_km_charge numeric,
  ADD COLUMN IF NOT EXISTS return_fuel_charge numeric,
  ADD COLUMN IF NOT EXISTS return_penalties numeric,
  ADD COLUMN IF NOT EXISTS return_deposit_kept numeric,
  ADD COLUMN IF NOT EXISTS return_deposit_returned numeric,
  ADD COLUMN IF NOT EXISTS return_balance_due numeric,
  ADD COLUMN IF NOT EXISTS return_notes text;
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS expiry_reminders_sent text[] NOT NULL DEFAULT '{}';
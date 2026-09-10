ALTER TABLE public.pricing_modifiers
  ADD COLUMN IF NOT EXISTS ramp_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS peak_percent numeric,
  ADD COLUMN IF NOT EXISTS peak_at time without time zone;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hire_mode text NOT NULL DEFAULT 'chauffeured',
  ADD COLUMN IF NOT EXISTS hire_daily_rate numeric,
  ADD COLUMN IF NOT EXISTS hire_notes text;

CREATE TABLE IF NOT EXISTS public.hire_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL DEFAULT concat('HQ-', upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'corporate',
  organisation text,
  contact_name text,
  contact_phone text,
  contact_email text,
  vehicle_class vehicle_class NOT NULL,
  drive_mode text NOT NULL DEFAULT 'chauffeured',
  start_at timestamp with time zone NOT NULL,
  days integer NOT NULL DEFAULT 1,
  passengers integer NOT NULL DEFAULT 1,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  estimated_total numeric NOT NULL DEFAULT 0,
  quoted_total numeric,
  currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'submitted',
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.hire_quotes TO authenticated;
GRANT ALL ON public.hire_quotes TO service_role;

ALTER TABLE public.hire_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own hire quotes readable" ON public.hire_quotes
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "create own hire quotes" ON public.hire_quotes
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "staff update hire quotes" ON public.hire_quotes
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER t_hire_quotes_updated BEFORE UPDATE ON public.hire_quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS hire_quotes_requester_idx ON public.hire_quotes (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicles_hire_idx ON public.vehicles (hire_available, vehicle_class) WHERE hire_available;
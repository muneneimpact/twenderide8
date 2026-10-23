CREATE TABLE IF NOT EXISTS public.vehicle_interest_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_needs text NOT NULL,
  contact_name text NOT NULL,
  contact_phone text,
  contact_email text,
  recommended_vehicle_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','responded','closed')),
  admin_response text,
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_phone IS NOT NULL OR contact_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS vehicle_interest_requests_status_idx
  ON public.vehicle_interest_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_interest_requests_created_idx
  ON public.vehicle_interest_requests(created_at DESC);
REVOKE ALL ON public.vehicle_interest_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.vehicle_interest_requests TO service_role;
ALTER TABLE public.vehicle_interest_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER t_vehicle_interest_requests_updated
  BEFORE UPDATE ON public.vehicle_interest_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

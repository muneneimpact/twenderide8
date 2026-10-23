CREATE TABLE IF NOT EXISTS public.partner_interest_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL CHECK (request_type IN ('driver', 'car_owner')),
  full_name text NOT NULL,
  phone text NOT NULL,
  town text NOT NULL,
  preferred_work_type text,
  owns_vehicle boolean,
  licence_psv_status text,
  number_of_cars integer,
  best_time text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'approved', 'declined')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_interest_requests_status_idx
  ON public.partner_interest_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_interest_requests_phone_type_idx
  ON public.partner_interest_requests(phone, request_type, created_at DESC);
REVOKE ALL ON public.partner_interest_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_interest_requests TO service_role;
ALTER TABLE public.partner_interest_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER t_partner_interest_requests_updated
  BEFORE UPDATE ON public.partner_interest_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

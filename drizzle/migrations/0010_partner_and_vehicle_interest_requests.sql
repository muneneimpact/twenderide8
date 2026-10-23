CREATE TABLE public.partner_interest_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL CHECK (request_type IN ('driver','car_owner')),
  full_name text NOT NULL,
  phone text NOT NULL,
  town text NOT NULL,
  preferred_work_type text CHECK (preferred_work_type IN ('boda','e_boda','car_taxi','delivery')),
  owns_vehicle boolean,
  licence_psv_status text,
  number_of_cars integer CHECK (number_of_cars BETWEEN 1 AND 100),
  best_time text NOT NULL,
  note text,
  whatsapp_opt_in boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','approved','declined')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.partner_interest_requests TO authenticated;
GRANT ALL ON public.partner_interest_requests TO service_role;
ALTER TABLE public.partner_interest_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partner interest" ON public.partner_interest_requests FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff update partner interest" ON public.partner_interest_requests FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX partner_interest_phone_idx ON public.partner_interest_requests (phone, request_type, created_at DESC);
CREATE TRIGGER partner_interest_updated_at BEFORE UPDATE ON public.partner_interest_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.vehicle_interest_requests (
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
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.vehicle_interest_requests TO authenticated;
GRANT ALL ON public.vehicle_interest_requests TO service_role;
ALTER TABLE public.vehicle_interest_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read vehicle interest" ON public.vehicle_interest_requests FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff update vehicle interest" ON public.vehicle_interest_requests FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX vehicle_interest_created_idx ON public.vehicle_interest_requests (created_at DESC);
CREATE TRIGGER vehicle_interest_updated_at BEFORE UPDATE ON public.vehicle_interest_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
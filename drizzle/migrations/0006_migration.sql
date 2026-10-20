ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_kra_pin text, ADD COLUMN IF NOT EXISTS company_billing_email text;

CREATE TABLE public.lost_found_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.lost_found_reports(id) ON DELETE CASCADE,
  claimant_id uuid NOT NULL,
  ride_id uuid NOT NULL,
  description text NOT NULL,
  contact_phone text,
  security_details text,
  status text NOT NULL DEFAULT 'pending',
  driver_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, claimant_id)
);
GRANT SELECT ON public.lost_found_claims TO authenticated;
GRANT ALL ON public.lost_found_claims TO service_role;
ALTER TABLE public.lost_found_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Claimant reads own claims" ON public.lost_found_claims FOR SELECT TO authenticated USING (claimant_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE TABLE public.etr_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL,
  requester_id uuid NOT NULL,
  company_name text NOT NULL,
  kra_pin text NOT NULL,
  billing_email text,
  status text NOT NULL DEFAULT 'requested',
  file_path text,
  uploaded_by uuid,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id)
);
GRANT SELECT ON public.etr_requests TO authenticated;
GRANT ALL ON public.etr_requests TO service_role;
ALTER TABLE public.etr_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Requester or staff read ETR" ON public.etr_requests FOR SELECT TO authenticated USING (requester_id = auth.uid() OR public.is_staff(auth.uid()));
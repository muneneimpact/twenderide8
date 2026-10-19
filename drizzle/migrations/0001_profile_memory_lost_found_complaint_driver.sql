ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id_number text, ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.support_cases ADD COLUMN IF NOT EXISTS involved_driver_id uuid;

CREATE TABLE public.lost_found_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reporter_role text NOT NULL CHECK (reporter_role IN ('customer','driver')),
  kind text NOT NULL CHECK (kind IN ('lost','found')),
  ride_ids uuid[] NOT NULL DEFAULT '{}',
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','returned','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.lost_found_reports TO authenticated;
GRANT ALL ON public.lost_found_reports TO service_role;
ALTER TABLE public.lost_found_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or staff read lost found" ON public.lost_found_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "own insert lost found" ON public.lost_found_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "staff update lost found" ON public.lost_found_reports FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()));
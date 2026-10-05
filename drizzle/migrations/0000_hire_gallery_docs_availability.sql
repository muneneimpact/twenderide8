ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hire_rules text;

ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS hirer_type text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS renter_name text,
  ADD COLUMN IF NOT EXISTS renter_id_number text,
  ADD COLUMN IF NOT EXISTS id_document_path text,
  ADD COLUMN IF NOT EXISTS license_document_path text,
  ADD COLUMN IF NOT EXISTS rules_accepted_at timestamptz;

CREATE INDEX IF NOT EXISTS hire_quotes_vehicle_dates_idx ON public.hire_quotes (vehicle_id, start_at);

CREATE OR REPLACE FUNCTION public.prevent_hire_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _end timestamptz;
BEGIN
  IF NEW.vehicle_id IS NULL OR NEW.status NOT IN ('submitted','quoted','confirmed') THEN
    RETURN NEW;
  END IF;
  _end := COALESCE(NEW.end_at, NEW.start_at + make_interval(days => NEW.days));
  IF EXISTS (
    SELECT 1 FROM public.hire_quotes q
    WHERE q.vehicle_id = NEW.vehicle_id
      AND q.id <> NEW.id
      AND q.status IN ('submitted','quoted','confirmed')
      AND q.start_at < _end
      AND COALESCE(q.end_at, q.start_at + make_interval(days => q.days)) > NEW.start_at
  ) THEN
    RAISE EXCEPTION 'This vehicle is already booked for some of those dates. Please choose other dates.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hire_quotes_no_overlap ON public.hire_quotes;
CREATE TRIGGER hire_quotes_no_overlap
BEFORE INSERT OR UPDATE OF vehicle_id, start_at, end_at, days, status ON public.hire_quotes
FOR EACH ROW EXECUTE FUNCTION public.prevent_hire_overlap();

CREATE POLICY "hire docs own upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'hire-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "hire docs own read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'hire-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff(auth.uid())));
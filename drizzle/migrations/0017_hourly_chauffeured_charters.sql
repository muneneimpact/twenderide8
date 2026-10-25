ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_hourly_available boolean NOT NULL DEFAULT false;

ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS duration_hours integer;

ALTER TABLE public.hire_offers
  ADD COLUMN IF NOT EXISTS counter_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS counter_note text;

ALTER TABLE public.hire_quotes
  ADD CONSTRAINT hire_quotes_service_type_check
  CHECK (service_type IN ('daily', 'hourly_charter'));
ALTER TABLE public.hire_quotes
  ADD CONSTRAINT hire_quotes_hourly_duration_check
  CHECK (duration_hours IS NULL OR duration_hours BETWEEN 1 AND 24);

-- Hourly inquiries do not reserve a car while owners are still preparing offers.
-- Once the customer accepts, the request becomes a confirmed payment hold and
-- the existing overlap protection treats it like any other pending payment.
CREATE OR REPLACE FUNCTION public.prevent_hire_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _end timestamptz;
BEGIN
  IF NEW.vehicle_id IS NULL OR NEW.status NOT IN ('submitted', 'quoted', 'confirmed') THEN
    RETURN NEW;
  END IF;
  IF NEW.service_type = 'hourly_charter'
     AND NEW.status IN ('submitted', 'quoted')
     AND NEW.payment_status = 'unpaid' THEN
    RETURN NEW;
  END IF;
  _end := COALESCE(NEW.end_at, NEW.start_at + make_interval(days => NEW.days));
  PERFORM 1 FROM public.vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM public.hire_quotes q
    WHERE q.vehicle_id = NEW.vehicle_id
      AND q.id <> NEW.id
      AND q.status IN ('submitted', 'quoted', 'confirmed')
      AND (
        q.payment_status NOT IN ('unpaid', 'pending', 'failed', 'cancelled', 'timed_out')
        OR q.payment_hold_expires_at > now()
        OR (q.status = 'confirmed' AND q.pay_later_method IS NOT NULL)
      )
      AND q.start_at < _end
      AND COALESCE(q.end_at, q.start_at + make_interval(days => q.days)) > NEW.start_at
  ) THEN
    RAISE EXCEPTION 'This vehicle is already booked for some of those dates. Please choose another time.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_hire_overlap_trigger ON public.hire_quotes;
DROP TRIGGER IF EXISTS hire_quotes_prevent_overlap ON public.hire_quotes;
CREATE TRIGGER hire_quotes_prevent_overlap
  BEFORE INSERT OR UPDATE OF vehicle_id, start_at, end_at, days, status, payment_status, payment_hold_expires_at
  ON public.hire_quotes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hire_overlap();

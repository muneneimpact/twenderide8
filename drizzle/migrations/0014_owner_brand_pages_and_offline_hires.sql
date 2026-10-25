CREATE TABLE IF NOT EXISTS public.hire_owner_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_name text NOT NULL CHECK (char_length(trim(brand_name)) BETWEEN 2 AND 80),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_data_url text,
  owner_bio text NOT NULL DEFAULT '',
  business_info text NOT NULL DEFAULT '',
  marketing_content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hire_owner_brands_brand_name_lower_uidx
  ON public.hire_owner_brands (lower(trim(brand_name)));
ALTER TABLE public.hire_owner_brands ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.hire_vehicle_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hire_vehicle_blackouts_valid_range CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS hire_vehicle_blackouts_vehicle_dates_idx
  ON public.hire_vehicle_blackouts (vehicle_id, start_date, end_date);
ALTER TABLE public.hire_vehicle_blackouts ENABLE ROW LEVEL SECURITY;

-- Serialize customer bookings and owner blackout creation on the vehicle row.
CREATE OR REPLACE FUNCTION public.guard_hire_vehicle_blackout_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_end timestamptz;
  v_booking_start timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'hire_quotes' THEN
    IF NEW.vehicle_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_booking_start := NEW.start_at;
    v_booking_end := COALESCE(NEW.end_at, NEW.start_at + make_interval(days => NEW.days));
    PERFORM 1 FROM public.vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
    IF EXISTS (
      SELECT 1
      FROM public.hire_vehicle_blackouts b
      WHERE b.vehicle_id = NEW.vehicle_id
        AND (b.start_date::timestamp AT TIME ZONE 'Africa/Nairobi') < v_booking_end
        AND ((b.end_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi') > v_booking_start
    ) THEN
      RAISE EXCEPTION 'This vehicle is unavailable for some of those dates.';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM public.hire_vehicle_blackouts b
    WHERE b.vehicle_id = NEW.vehicle_id
      AND b.id IS DISTINCT FROM NEW.id
      AND b.start_date <= NEW.end_date
      AND b.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'These dates overlap another offline hire for this car.';
  END IF;
  v_booking_start := NEW.start_date::timestamp AT TIME ZONE 'Africa/Nairobi';
  v_booking_end := (NEW.end_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi';
  IF EXISTS (
    SELECT 1
    FROM public.hire_quotes q
    WHERE q.vehicle_id = NEW.vehicle_id
      AND q.status IN ('submitted', 'quoted', 'confirmed')
      AND (
        q.payment_status IN ('legacy', 'partial', 'paid')
        OR (q.status = 'confirmed' AND q.pay_later_method IS NOT NULL)
        OR (q.payment_status = 'pending' AND q.payment_hold_expires_at > now())
      )
      AND q.start_at < v_booking_end
      AND COALESCE(q.end_at, q.start_at + make_interval(days => q.days)) > v_booking_start
  ) THEN
    RAISE EXCEPTION 'These dates overlap an existing platform booking.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_hire_quote_offline_blackout ON public.hire_quotes;
CREATE TRIGGER guard_hire_quote_offline_blackout
  BEFORE INSERT ON public.hire_quotes
  FOR EACH ROW EXECUTE FUNCTION public.guard_hire_vehicle_blackout_overlap();

DROP TRIGGER IF EXISTS guard_offline_blackout_overlap ON public.hire_vehicle_blackouts;
CREATE TRIGGER guard_offline_blackout_overlap
  BEFORE INSERT OR UPDATE ON public.hire_vehicle_blackouts
  FOR EACH ROW EXECUTE FUNCTION public.guard_hire_vehicle_blackout_overlap();

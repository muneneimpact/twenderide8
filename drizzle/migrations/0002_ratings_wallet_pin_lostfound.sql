CREATE TABLE IF NOT EXISTS public.customer_wallet_pins (
  user_id uuid PRIMARY KEY,
  pin_hash text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.customer_wallet_pins TO service_role;
ALTER TABLE public.customer_wallet_pins ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.wallet_pin_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wallet_pin_resets TO service_role;
ALTER TABLE public.wallet_pin_resets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lost_found_reports ADD COLUMN IF NOT EXISTS photo_path text;
ALTER TABLE public.lost_found_claims ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamptz;
ALTER TABLE public.lost_found_claims ADD COLUMN IF NOT EXISTS handover_request text;
ALTER TABLE public.lost_found_claims ADD COLUMN IF NOT EXISTS dropoff_note text;
ALTER TABLE public.lost_found_claims ADD COLUMN IF NOT EXISTS phone_shared_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ratings_ride_rater_uidx ON public.ratings (ride_id, rater_id);

CREATE OR REPLACE FUNCTION public.refresh_driver_rating() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.drivers d
     SET rating = COALESCE((SELECT round(avg(r.score)::numeric, 2) FROM public.ratings r
                            JOIN public.rides x ON x.id = r.ride_id
                            WHERE r.ratee_id = NEW.ratee_id AND x.driver_id = NEW.ratee_id), d.rating),
         updated_at = now()
   WHERE d.id = NEW.ratee_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_refresh_driver_rating ON public.ratings;
CREATE TRIGGER trg_refresh_driver_rating AFTER INSERT OR UPDATE ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.refresh_driver_rating();
-- Hire listings have their own review lifecycle; approval to drive a vehicle
-- does not automatically approve it for public rental.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_approval_status text NOT NULL DEFAULT 'not_submitted',
  ADD COLUMN IF NOT EXISTS hire_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hire_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS hire_rejection_reason text;

UPDATE public.vehicles
SET hire_approval_status = 'approved'
WHERE hire_available = true AND hire_approval_status = 'not_submitted';

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_hire_approval_status_check
  CHECK (hire_approval_status IN ('not_submitted', 'pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS vehicles_pending_hire_review_idx
  ON public.vehicles (created_at DESC)
  WHERE hire_approval_status = 'pending';

-- Enforce plate uniqueness after canonical formatting while allowing legacy
-- duplicate rows to be resolved without making this migration destructive.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_vehicle_plate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  normalized_plate text;
BEGIN
  normalized_plate := regexp_replace(upper(coalesce(NEW.plate_number, '')), '[^A-Z0-9]', '', 'g');
  IF normalized_plate = '' THEN
    RAISE EXCEPTION 'A valid vehicle plate number is required' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_plate, 0));
  IF EXISTS (
    SELECT 1
    FROM public.vehicles v
    WHERE v.id IS DISTINCT FROM NEW.id
      AND regexp_replace(upper(coalesce(v.plate_number, '')), '[^A-Z0-9]', '', 'g') = normalized_plate
  ) THEN
    RAISE EXCEPTION 'That number plate is already registered' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_prevent_duplicate_plate ON public.vehicles;
CREATE TRIGGER vehicles_prevent_duplicate_plate
BEFORE INSERT OR UPDATE OF plate_number ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_vehicle_plate();

-- Delivery businesses use the existing fleet owner and settlement model.
ALTER TABLE public.fleets
  ADD COLUMN IF NOT EXISTS delivery_business_name text,
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_base_fee numeric(12,2),
  ADD COLUMN IF NOT EXISTS delivery_per_km numeric(12,2),
  ADD COLUMN IF NOT EXISTS delivery_per_minute numeric(12,2),
  ADD COLUMN IF NOT EXISTS delivery_minimum_fee numeric(12,2),
  ADD COLUMN IF NOT EXISTS delivery_rate_status text NOT NULL DEFAULT 'not_configured';

ALTER TABLE public.fleets
  ADD CONSTRAINT fleets_delivery_rate_status_check
  CHECK (delivery_rate_status IN ('not_configured', 'pending', 'approved'));

CREATE INDEX IF NOT EXISTS fleets_delivery_discovery_idx
  ON public.fleets (status, delivery_enabled, delivery_rate_status);

CREATE TABLE IF NOT EXISTS public.fleet_delivery_rate_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id uuid NOT NULL REFERENCES public.fleets(id) ON DELETE CASCADE,
  base_fee numeric(12,2) NOT NULL CHECK (base_fee >= 0),
  per_km numeric(12,2) NOT NULL CHECK (per_km >= 0),
  per_minute numeric(12,2) NOT NULL CHECK (per_minute >= 0),
  minimum_fee numeric(12,2) NOT NULL CHECK (minimum_fee >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_delivery_rate_proposals_pending_idx
  ON public.fleet_delivery_rate_proposals (submitted_at ASC)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS fleet_delivery_rate_one_pending_idx
  ON public.fleet_delivery_rate_proposals (fleet_id)
  WHERE status = 'pending';

ALTER TABLE public.fleet_delivery_rate_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fleet_delivery_rate_proposals FROM anon, authenticated;
GRANT ALL ON public.fleet_delivery_rate_proposals TO service_role;

ALTER TABLE public.route_quotes
  ADD COLUMN IF NOT EXISTS trip_kind text NOT NULL DEFAULT 'cab',
  ADD COLUMN IF NOT EXISTS delivery_fleet_id uuid REFERENCES public.fleets(id);
ALTER TABLE public.route_quotes
  ADD CONSTRAINT route_quotes_trip_kind_check CHECK (trip_kind IN ('cab', 'delivery'));

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS trip_kind text NOT NULL DEFAULT 'cab';
ALTER TABLE public.rides
  ADD CONSTRAINT rides_trip_kind_check CHECK (trip_kind IN ('cab', 'delivery'));

CREATE INDEX IF NOT EXISTS route_quotes_delivery_fleet_idx
  ON public.route_quotes (delivery_fleet_id, created_at DESC)
  WHERE trip_kind = 'delivery';


CREATE OR REPLACE FUNCTION public.review_delivery_rate_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_reviewer_id uuid,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proposal public.fleet_delivery_rate_proposals%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid delivery rate decision';
  END IF;
  SELECT * INTO proposal
  FROM public.fleet_delivery_rate_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;
  IF NOT FOUND OR proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Delivery rate proposal is no longer pending';
  END IF;

  UPDATE public.fleet_delivery_rate_proposals
  SET status = p_decision,
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      review_note = p_note,
      updated_at = now()
  WHERE id = p_proposal_id;

  IF p_decision = 'approved' THEN
    UPDATE public.fleets
    SET delivery_base_fee = proposal.base_fee,
        delivery_per_km = proposal.per_km,
        delivery_per_minute = proposal.per_minute,
        delivery_minimum_fee = proposal.minimum_fee,
        delivery_rate_status = 'approved',
        updated_at = now()
    WHERE id = proposal.fleet_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.fleets
    WHERE id = proposal.fleet_id
      AND delivery_rate_status = 'approved'
      AND delivery_base_fee IS NOT NULL
  ) THEN
    UPDATE public.fleets
    SET delivery_rate_status = 'not_configured', updated_at = now()
    WHERE id = proposal.fleet_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.review_delivery_rate_proposal(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_delivery_rate_proposal(uuid, text, uuid, text) TO service_role;

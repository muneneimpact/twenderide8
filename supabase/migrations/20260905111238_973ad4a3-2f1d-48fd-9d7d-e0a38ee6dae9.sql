ALTER TABLE public.route_quotes ADD COLUMN IF NOT EXISTS stops jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS queued_after_ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS rides_queued_after_ride_id_idx ON public.rides(queued_after_ride_id);
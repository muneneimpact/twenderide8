
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS seats integer,
  ADD COLUMN IF NOT EXISTS hire_description text;

CREATE POLICY "hire listed vehicles readable"
ON public.vehicles FOR SELECT TO authenticated
USING (hire_available = true AND status = 'approved');

ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id),
  ADD COLUMN IF NOT EXISTS pickup_label text,
  ADD COLUMN IF NOT EXISTS pickup_lat numeric,
  ADD COLUMN IF NOT EXISTS pickup_lng numeric,
  ADD COLUMN IF NOT EXISTS accepted_offer_id uuid,
  ADD COLUMN IF NOT EXISTS assigned_driver_id uuid REFERENCES auth.users(id);

CREATE TABLE IF NOT EXISTS public.hire_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.hire_quotes(id) ON DELETE CASCADE,
  responder_id uuid NOT NULL REFERENCES auth.users(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  price numeric NOT NULL CHECK (price >= 0),
  note text,
  status text NOT NULL DEFAULT 'offered',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, responder_id)
);

GRANT SELECT, INSERT, UPDATE ON public.hire_offers TO authenticated;
GRANT ALL ON public.hire_offers TO service_role;

ALTER TABLE public.hire_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hire offers readable"
ON public.hire_offers FOR SELECT TO authenticated
USING (
  responder_id = auth.uid()
  OR is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.hire_quotes q WHERE q.id = quote_id AND q.requester_id = auth.uid())
);

CREATE POLICY "hire offers insert by responder"
ON public.hire_offers FOR INSERT TO authenticated
WITH CHECK (responder_id = auth.uid());

CREATE POLICY "hire offers update"
ON public.hire_offers FOR UPDATE TO authenticated
USING (
  responder_id = auth.uid()
  OR is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.hire_quotes q WHERE q.id = quote_id AND q.requester_id = auth.uid())
)
WITH CHECK (
  responder_id = auth.uid()
  OR is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.hire_quotes q WHERE q.id = quote_id AND q.requester_id = auth.uid())
);

CREATE TRIGGER t_hire_offers_updated
BEFORE UPDATE ON public.hire_offers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS hire_offers_quote_idx ON public.hire_offers (quote_id);
CREATE INDEX IF NOT EXISTS hire_quotes_open_idx ON public.hire_quotes (status, vehicle_class);

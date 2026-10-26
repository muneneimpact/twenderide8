CREATE TABLE IF NOT EXISTS public.hire_owner_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_slug text NOT NULL,
  customer_name text NOT NULL CHECK (char_length(trim(customer_name)) BETWEEN 2 AND 100),
  customer_phone text NOT NULL,
  customer_email text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  service_type text NOT NULL DEFAULT 'general' CHECK (service_type IN ('self_drive', 'chauffeured', 'hourly', 'general')),
  dates_note text,
  message text NOT NULL CHECK (char_length(trim(message)) BETWEEN 10 AND 1200),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hire_owner_inquiries_owner_created_idx
  ON public.hire_owner_inquiries (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hire_owner_inquiries_brand_created_idx
  ON public.hire_owner_inquiries (brand_slug, created_at DESC);
GRANT ALL ON public.hire_owner_inquiries TO service_role;
ALTER TABLE public.hire_owner_inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hire owners read their inquiries" ON public.hire_owner_inquiries
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Hire owners update their inquiries" ON public.hire_owner_inquiries
  FOR UPDATE TO authenticated USING (owner_user_id = auth.uid() OR public.is_staff(auth.uid()));

ALTER TABLE public.hire_owner_brands
  ADD COLUMN IF NOT EXISTS marketing_posts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_image_data_url text,
  ADD COLUMN IF NOT EXISTS accent_color text NOT NULL DEFAULT '#22a35b';

CREATE TABLE IF NOT EXISTS public.hire_marketing_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, period_key)
);

GRANT SELECT ON public.hire_marketing_generations TO authenticated;
GRANT ALL ON public.hire_marketing_generations TO service_role;
ALTER TABLE public.hire_marketing_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read their marketing generation" ON public.hire_marketing_generations;
CREATE POLICY "Owners read their marketing generation" ON public.hire_marketing_generations
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS hire_marketing_generations_owner_period_idx
  ON public.hire_marketing_generations(owner_user_id, period_key);
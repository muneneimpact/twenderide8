CREATE TABLE IF NOT EXISTS public.hire_owner_trusted_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name text NOT NULL CHECK (char_length(trim(brand_name)) BETWEEN 2 AND 120),
  permission_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, brand_name)
);
CREATE INDEX IF NOT EXISTS hire_owner_trusted_brands_status_idx ON public.hire_owner_trusted_brands (status);
ALTER TABLE public.hire_owner_trusted_brands ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.hire_owner_trusted_brands TO service_role;

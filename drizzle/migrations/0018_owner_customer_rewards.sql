CREATE TABLE IF NOT EXISTS public.hire_owner_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 100),
  description text NOT NULL CHECK (char_length(trim(description)) BETWEEN 2 AND 500),
  reward_points integer NOT NULL DEFAULT 0 CHECK (reward_points >= 0 AND reward_points <= 100000),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  merchandise text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hire_owner_promotions_public_idx ON public.hire_owner_promotions (owner_user_id, status, expires_at);
ALTER TABLE public.hire_owner_promotions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.hire_owner_promotions TO service_role;

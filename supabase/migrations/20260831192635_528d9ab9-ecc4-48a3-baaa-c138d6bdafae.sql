-- PROMOTIONS ---------------------------------------------------------------
CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  discount_percent numeric NOT NULL DEFAULT 0,
  max_discount_percent numeric NOT NULL DEFAULT 0,
  max_discount_amount numeric,
  min_fare numeric,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  usage_limit integer,
  usage_count integer NOT NULL DEFAULT 0,
  applies_to text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read active promotions"
  ON public.promotions FOR SELECT TO authenticated
  USING (active OR public.is_staff(auth.uid()));

CREATE TRIGGER t_promotions_updated BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_promotions_code ON public.promotions (code);

-- PROMOTION REDEMPTIONS -----------------------------------------------------
CREATE TABLE public.promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  code text NOT NULL,
  discount_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, ride_id)
);

GRANT SELECT ON public.promotion_redemptions TO authenticated;
GRANT ALL ON public.promotion_redemptions TO service_role;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their own redemptions"
  ON public.promotion_redemptions FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE INDEX idx_promotion_redemptions_customer ON public.promotion_redemptions (customer_id, created_at DESC);

-- SUPPORT CASES -------------------------------------------------------------
CREATE TABLE public.support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to uuid,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.support_cases TO authenticated;
GRANT ALL ON public.support_cases TO service_role;
ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own or staff can read support cases"
  ON public.support_cases FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Customers open their own support cases"
  ON public.support_cases FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "Staff manage support cases"
  ON public.support_cases FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER t_support_cases_updated BEFORE UPDATE ON public.support_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_support_cases_customer ON public.support_cases (customer_id, created_at DESC);
CREATE INDEX idx_support_cases_status ON public.support_cases (status, last_message_at DESC);

-- SUPPORT MESSAGES ----------------------------------------------------------
CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
  sender_id uuid,
  sender_role text NOT NULL DEFAULT 'customer',
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants read support messages"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_cases c WHERE c.id = case_id AND c.customer_id = auth.uid())
  );
CREATE POLICY "Participants write support messages"
  ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      public.is_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.support_cases c WHERE c.id = case_id AND c.customer_id = auth.uid())
    )
  );

CREATE INDEX idx_support_messages_case ON public.support_messages (case_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_cases;

-- PROFILE PREFERENCES -------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_preference text NOT NULL DEFAULT 'stk_push',
  ADD COLUMN IF NOT EXISTS share_driver_code boolean NOT NULL DEFAULT true;
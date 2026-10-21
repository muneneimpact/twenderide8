-- 1. Confirmed pay-later (company) bookings must block the vehicle's dates too.
CREATE OR REPLACE FUNCTION public.prevent_hire_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _end timestamptz;
BEGIN
  IF NEW.vehicle_id IS NULL OR NEW.status NOT IN ('submitted', 'quoted', 'confirmed') THEN
    RETURN NEW;
  END IF;
  _end := COALESCE(NEW.end_at, NEW.start_at + make_interval(days => NEW.days));
  IF EXISTS (
    SELECT 1
    FROM public.hire_quotes q
    WHERE q.vehicle_id = NEW.vehicle_id
      AND q.id <> NEW.id
      AND q.status IN ('submitted', 'quoted', 'confirmed')
      AND (
        q.payment_status NOT IN ('unpaid', 'pending', 'failed', 'cancelled', 'timed_out')
        OR q.payment_hold_expires_at > now()
        OR (q.status = 'confirmed' AND q.pay_later_method IS NOT NULL)
      )
      AND q.start_at < _end
      AND COALESCE(q.end_at, q.start_at + make_interval(days => q.days)) > NEW.start_at
  ) THEN
    RAISE EXCEPTION 'This vehicle is already booked for some of those dates. Please choose other dates.';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Per-vehicle opt-in: does this owner allow verified companies to pay later?
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_pay_later_allowed boolean NOT NULL DEFAULT false;

-- 3. Owner verification stamp on company bookings.
ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS company_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_verified_by uuid;

-- 4. Company KYC documents, optionally saved for future hires.
CREATE TABLE IF NOT EXISTS public.business_kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_kind text NOT NULL,
  file_path text NOT NULL,
  saved_for_future boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_kyc_documents TO authenticated;
GRANT ALL ON public.business_kyc_documents TO service_role;
ALTER TABLE public.business_kyc_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own business documents"
  ON public.business_kyc_documents
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Staff can read business documents"
  ON public.business_kyc_documents
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
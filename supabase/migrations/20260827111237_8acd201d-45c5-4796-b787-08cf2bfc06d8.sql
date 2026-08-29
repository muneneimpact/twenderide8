-- 1. Phone verification (server-only)
CREATE TABLE public.phone_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.phone_verifications TO service_role;
ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff can audit phone verifications"
  ON public.phone_verifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_phone_verifications_user ON public.phone_verifications (user_id, created_at DESC);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

-- 2. Provider-level communication log
CREATE TABLE public.comms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('sms','email')),
  event_type text NOT NULL,
  recipient text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL,
  payment_intent_id uuid REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  support_case_id uuid,
  provider text NOT NULL,
  provider_message_id text,
  network_id text,
  status text NOT NULL DEFAULT 'queued',
  response_code text,
  error_description text,
  attempts integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.comms_log TO authenticated;
GRANT ALL ON public.comms_log TO service_role;
ALTER TABLE public.comms_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipients see their own comms"
  ON public.comms_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE INDEX idx_comms_log_user ON public.comms_log (user_id, created_at DESC);
CREATE INDEX idx_comms_log_ride ON public.comms_log (ride_id, created_at DESC);
CREATE INDEX idx_comms_log_status ON public.comms_log (status, created_at DESC);
CREATE TRIGGER t_comms_log_updated BEFORE UPDATE ON public.comms_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
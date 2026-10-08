ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hire_payment_policy text NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_hire_payment_policy_check'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_hire_payment_policy_check
      CHECK (hire_payment_policy IN ('full', 'daily_flexible'));
  END IF;
END $$;

ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS payment_policy text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS payment_paid_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_minimum_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS commission_percent_snapshot numeric(5,2),
  ADD COLUMN IF NOT EXISTS payment_hold_expires_at timestamptz;

-- Existing requests keep their prior semantics and availability reservations.
UPDATE public.hire_quotes
SET payment_policy = 'legacy', payment_status = 'legacy'
WHERE payment_policy = 'legacy' AND payment_status = 'not_required';

ALTER TABLE public.payment_intents
  ALTER COLUMN ride_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS hire_quote_id uuid REFERENCES public.hire_quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payment_intents_hire_quote_idx
  ON public.payment_intents (hire_quote_id, created_at DESC)
  WHERE hire_quote_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_open_hire_per_quote_idx
  ON public.payment_intents (hire_quote_id)
  WHERE hire_quote_id IS NOT NULL
    AND status IN ('initiating', 'pending', 'awaiting_confirmation', 'processing');

CREATE INDEX IF NOT EXISTS hire_quotes_payment_status_idx
  ON public.hire_quotes (payment_status, payment_hold_expires_at)
  WHERE vehicle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hire_payment_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL UNIQUE REFERENCES public.payment_intents(id) ON DELETE RESTRICT,
  hire_quote_id uuid NOT NULL REFERENCES public.hire_quotes(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount > 0),
  commission_percent numeric(5,2) NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
  platform_fee_amount numeric(12,2) NOT NULL CHECK (platform_fee_amount >= 0),
  owner_net_amount numeric(12,2) NOT NULL CHECK (owner_net_amount >= 0),
  currency text NOT NULL DEFAULT 'KES',
  mpesa_receipt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hire_payment_settlements_owner_idx
  ON public.hire_payment_settlements (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hire_payment_settlements_quote_idx
  ON public.hire_payment_settlements (hire_quote_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.hire_owner_balances (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gross_paid_total numeric(12,2) NOT NULL DEFAULT 0,
  platform_fee_total numeric(12,2) NOT NULL DEFAULT 0,
  owner_balance numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hire_payment_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hire_owner_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hire_payment_settlements FROM anon, authenticated;
REVOKE ALL ON public.hire_owner_balances FROM anon, authenticated;
GRANT ALL ON public.hire_payment_settlements TO service_role;
GRANT ALL ON public.hire_owner_balances TO service_role;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opted_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_source text;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS hire_quote_id uuid REFERENCES public.hire_quotes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_idempotency_key_idx
  ON public.whatsapp_messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'hire_commission_percent',
  to_jsonb(7::numeric),
  'Platform commission percentage applied to each confirmed hire payment. Existing bookings retain their commission snapshot.'
)
ON CONFLICT (key) DO NOTHING;

-- An unpaid car-hire attempt temporarily reserves its dates only while its M-Pesa
-- attempt is alive. Legacy quotations and paid daily bookings remain reserved.
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
      )
      AND q.start_at < _end
      AND COALESCE(q.end_at, q.start_at + make_interval(days => q.days)) > NEW.start_at
  ) THEN
    RAISE EXCEPTION 'This vehicle is already booked for some of those dates. Please choose other dates.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hire_quotes_no_overlap ON public.hire_quotes;
CREATE TRIGGER hire_quotes_no_overlap
BEFORE INSERT OR UPDATE OF vehicle_id, start_at, end_at, days, status, payment_status, payment_hold_expires_at
ON public.hire_quotes
FOR EACH ROW EXECUTE FUNCTION public.prevent_hire_overlap();

CREATE OR REPLACE FUNCTION public.apply_hire_payment(p_payment_intent_id uuid, p_mpesa_receipt text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
  v_quote public.hire_quotes%ROWTYPE;
  v_owner_id uuid;
  v_total_paid numeric(12,2);
  v_threshold numeric(12,2);
  v_commission_percent numeric(5,2);
  v_fee numeric(12,2);
  v_net numeric(12,2);
  v_inserted_id uuid;
BEGIN
  SELECT * INTO v_intent
  FROM public.payment_intents
  WHERE id = p_payment_intent_id
  FOR UPDATE;
  IF NOT FOUND OR v_intent.hire_quote_id IS NULL THEN
    RAISE EXCEPTION 'Hire payment intent was not found.';
  END IF;
  IF v_intent.status <> 'paid' THEN
    RAISE EXCEPTION 'Hire payment is not verified as paid.';
  END IF;

  SELECT * INTO v_quote
  FROM public.hire_quotes
  WHERE id = v_intent.hire_quote_id
  FOR UPDATE;
  IF NOT FOUND OR v_quote.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Hire booking was not found.';
  END IF;

  SELECT COALESCE(f.owner_id, v.owner_driver_id) INTO v_owner_id
  FROM public.vehicles v
  LEFT JOIN public.fleets f ON f.id = v.fleet_id
  WHERE v.id = v_quote.vehicle_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Hire vehicle has no owner account.';
  END IF;

  v_commission_percent := LEAST(100, GREATEST(0, COALESCE(
    v_quote.commission_percent_snapshot,
    (SELECT NULLIF(value #>> '{}', '')::numeric
      FROM public.system_settings WHERE key = 'hire_commission_percent'),
    7
  )));
  v_fee := ROUND(v_intent.amount * v_commission_percent / 100, 2);
  v_net := GREATEST(0, v_intent.amount - v_fee);

  INSERT INTO public.hire_payment_settlements (
    payment_intent_id, hire_quote_id, owner_user_id, gross_amount,
    commission_percent, platform_fee_amount, owner_net_amount, currency, mpesa_receipt
  ) VALUES (
    v_intent.id, v_quote.id, v_owner_id, v_intent.amount,
    v_commission_percent, v_fee, v_net, COALESCE(v_intent.currency, 'KES'), p_mpesa_receipt
  )
  ON CONFLICT (payment_intent_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    INSERT INTO public.hire_owner_balances (
      owner_user_id, gross_paid_total, platform_fee_total, owner_balance, updated_at
    ) VALUES (v_owner_id, v_intent.amount, v_fee, v_net, now())
    ON CONFLICT (owner_user_id) DO UPDATE SET
      gross_paid_total = public.hire_owner_balances.gross_paid_total + EXCLUDED.gross_paid_total,
      platform_fee_total = public.hire_owner_balances.platform_fee_total + EXCLUDED.platform_fee_total,
      owner_balance = public.hire_owner_balances.owner_balance + EXCLUDED.owner_balance,
      updated_at = now();
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM public.payment_intents
  WHERE hire_quote_id = v_quote.id AND status = 'paid';

  v_threshold := CASE
    WHEN v_quote.payment_policy = 'full' THEN COALESCE(v_quote.quoted_total, v_quote.estimated_total)
    ELSE COALESCE(v_quote.payment_minimum_amount, CEIL(v_quote.estimated_total / GREATEST(v_quote.days, 1)))
  END;

  UPDATE public.hire_quotes
  SET payment_paid_total = v_total_paid,
      payment_status = CASE
        WHEN v_total_paid >= COALESCE(v_quote.quoted_total, v_quote.estimated_total) THEN 'paid'
        WHEN v_total_paid >= v_threshold THEN 'partial'
        ELSE 'pending'
      END,
      status = CASE WHEN v_total_paid >= v_threshold THEN 'confirmed' ELSE status END,
      payment_hold_expires_at = CASE WHEN v_total_paid >= v_threshold THEN NULL ELSE payment_hold_expires_at END,
      updated_at = now()
  WHERE id = v_quote.id;

  RETURN jsonb_build_object(
    'settlement_created', v_inserted_id IS NOT NULL,
    'hire_quote_id', v_quote.id,
    'owner_user_id', v_owner_id,
    'gross_amount', v_intent.amount,
    'platform_fee_amount', v_fee,
    'owner_net_amount', v_net,
    'commission_percent', v_commission_percent,
    'paid_total', v_total_paid,
    'payment_threshold', v_threshold,
    'payment_status', CASE
      WHEN v_total_paid >= COALESCE(v_quote.quoted_total, v_quote.estimated_total) THEN 'paid'
      WHEN v_total_paid >= v_threshold THEN 'partial'
      ELSE 'pending'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_hire_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hire_payment(uuid, text) TO service_role;

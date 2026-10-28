-- Phase 1: protect money and availability under concurrent requests.
-- Existing duplicate active attempts are made terminal before the unique guards are added.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY hire_quote_id ORDER BY created_at, id) AS rn
  FROM public.payment_intents
  WHERE hire_quote_id IS NOT NULL
    AND status IN ('initiating', 'pending', 'awaiting_confirmation', 'processing')
)
UPDATE public.payment_intents p
SET status = 'failed',
    failure_reason = 'Superseded duplicate active payment intent during Phase 1 migration.'
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY ride_id ORDER BY created_at, id) AS rn
  FROM public.payment_intents
  WHERE ride_id IS NOT NULL
    AND status IN ('initiating', 'pending', 'awaiting_confirmation', 'processing')
)
UPDATE public.payment_intents p
SET status = 'failed',
    failure_reason = 'Superseded duplicate active payment intent during Phase 1 migration.'
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY customer_id ORDER BY created_at, id) AS rn
  FROM public.payment_intents
  WHERE ride_id IS NULL
    AND hire_quote_id IS NULL
    AND method = 'stk_push'
    AND idempotency_key LIKE 'wtopup:%'
    AND status IN ('initiating', 'pending', 'awaiting_confirmation', 'processing')
)
UPDATE public.payment_intents p
SET status = 'failed',
    failure_reason = 'Superseded duplicate active wallet top-up during Phase 1 migration.'
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_hire_idx
  ON public.payment_intents (hire_quote_id)
  WHERE hire_quote_id IS NOT NULL
    AND status IN ('initiating', 'pending', 'awaiting_confirmation', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_ride_idx
  ON public.payment_intents (ride_id)
  WHERE ride_id IS NOT NULL
    AND status IN ('initiating', 'pending', 'awaiting_confirmation', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_wallet_topup_idx
  ON public.payment_intents (customer_id)
  WHERE ride_id IS NULL
    AND hire_quote_id IS NULL
    AND method = 'stk_push'
    AND idempotency_key LIKE 'wtopup:%'
    AND status IN ('initiating', 'pending', 'awaiting_confirmation', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS hire_payment_settlements_payment_intent_uidx
  ON public.hire_payment_settlements (payment_intent_id);

-- The quote row is the serialization point for accepting competing hourly offers.
CREATE OR REPLACE FUNCTION public.accept_hire_offer(
  p_offer_id uuid,
  p_requester_id uuid,
  p_commission_percent numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offer public.hire_offers%ROWTYPE;
  v_quote public.hire_quotes%ROWTYPE;
  v_commission numeric(5,2);
  v_hourly boolean;
BEGIN
  SELECT * INTO v_offer FROM public.hire_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That offer no longer exists.'; END IF;

  SELECT * INTO v_quote FROM public.hire_quotes WHERE id = v_offer.quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.requester_id <> p_requester_id THEN
    RAISE EXCEPTION 'Not your request.';
  END IF;
  IF v_quote.status NOT IN ('submitted', 'quoted') OR v_offer.status <> 'offered' THEN
    RAISE EXCEPTION 'This offer is no longer open.';
  END IF;

  IF v_offer.vehicle_id IS NOT NULL THEN
    PERFORM 1 FROM public.vehicles WHERE id = v_offer.vehicle_id FOR UPDATE;
  END IF;

  v_hourly := v_quote.service_type = 'hourly_charter';
  v_commission := COALESCE(
    p_commission_percent,
    v_quote.commission_percent_snapshot,
    (SELECT value::numeric FROM public.system_settings WHERE key = 'hire_commission_percent'),
    7
  );
  v_commission := LEAST(100, GREATEST(0, v_commission));

  UPDATE public.hire_quotes
  SET status = 'confirmed',
      quoted_total = v_offer.price,
      vehicle_id = v_offer.vehicle_id,
      assigned_driver_id = v_offer.responder_id,
      accepted_offer_id = v_offer.id,
      payment_policy = CASE WHEN v_hourly THEN 'full' ELSE payment_policy END,
      payment_status = CASE WHEN v_hourly THEN 'unpaid' ELSE payment_status END,
      payment_minimum_amount = CASE WHEN v_hourly THEN v_offer.price ELSE payment_minimum_amount END,
      estimated_total = CASE WHEN v_hourly THEN 0 ELSE estimated_total END,
      commission_percent_snapshot = CASE WHEN v_hourly THEN v_commission ELSE commission_percent_snapshot END
  WHERE id = v_quote.id;

  UPDATE public.hire_offers SET status = 'accepted' WHERE id = v_offer.id;
  UPDATE public.hire_offers
  SET status = 'superseded'
  WHERE quote_id = v_quote.id AND id <> v_offer.id AND status IN ('offered', 'accepted');

  RETURN jsonb_build_object(
    'quote_id', v_quote.id,
    'reference', v_quote.reference,
    'responder_id', v_offer.responder_id,
    'vehicle_id', v_offer.vehicle_id,
    'price', v_offer.price,
    'hourly', v_hourly,
    'commission_percent', v_commission
  );
END;
$$;
REVOKE ALL ON FUNCTION public.accept_hire_offer(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_hire_offer(uuid, uuid, numeric) TO service_role;

-- One locked, idempotent settlement path for both verified M-Pesa and wallet payments.
CREATE OR REPLACE FUNCTION public.apply_hire_payment(
  p_payment_intent_id uuid,
  p_mpesa_receipt text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
  v_quote public.hire_quotes%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_owner_id uuid;
  v_existing public.hire_payment_settlements%ROWTYPE;
  v_total numeric(12,2);
  v_paid numeric(12,2);
  v_new_paid numeric(12,2);
  v_commission numeric(5,2);
  v_fee numeric(12,2);
  v_net numeric(12,2);
  v_status text;
BEGIN
  SELECT * INTO v_intent FROM public.payment_intents WHERE id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND OR v_intent.hire_quote_id IS NULL THEN RAISE EXCEPTION 'Hire payment intent not found.'; END IF;

  SELECT * INTO v_existing FROM public.hire_payment_settlements WHERE payment_intent_id = p_payment_intent_id;
  IF FOUND THEN
    SELECT * INTO v_quote FROM public.hire_quotes WHERE id = v_existing.hire_quote_id;
    RETURN jsonb_build_object(
      'hire_quote_id', v_existing.hire_quote_id,
      'owner_user_id', v_existing.owner_user_id,
      'gross_amount', v_existing.gross_amount,
      'platform_fee_amount', v_existing.platform_fee_amount,
      'owner_net_amount', v_existing.owner_net_amount,
      'commission_percent', v_existing.commission_percent,
      'payment_status', v_quote.payment_status,
      'paid_total', v_quote.payment_paid_total,
      'payment_threshold', v_quote.payment_minimum_amount
    );
  END IF;
  IF v_intent.status <> 'paid' THEN RAISE EXCEPTION 'Only a paid hire intent can be settled.'; END IF;

  SELECT * INTO v_quote FROM public.hire_quotes WHERE id = v_intent.hire_quote_id FOR UPDATE;
  IF NOT FOUND OR v_intent.customer_id <> v_quote.requester_id THEN RAISE EXCEPTION 'Hire payment does not belong to this booking.'; END IF;
  v_total := ROUND(COALESCE(v_quote.quoted_total, v_quote.estimated_total), 2);
  v_paid := ROUND(COALESCE(v_quote.payment_paid_total, 0), 2);
  IF v_intent.amount <= 0 OR v_intent.amount > v_total - v_paid THEN
    RAISE EXCEPTION 'Hire payment exceeds the remaining balance.';
  END IF;

  IF v_quote.vehicle_id IS NOT NULL THEN
    SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_quote.vehicle_id FOR SHARE;
    v_owner_id := v_vehicle.owner_driver_id;
    IF v_owner_id IS NULL AND v_vehicle.fleet_id IS NOT NULL THEN
      SELECT owner_id INTO v_owner_id FROM public.fleets WHERE id = v_vehicle.fleet_id;
    END IF;
  END IF;
  IF v_owner_id IS NULL THEN v_owner_id := v_quote.assigned_driver_id; END IF;
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Hire vehicle has no payable owner.'; END IF;

  v_commission := COALESCE(
    v_quote.commission_percent_snapshot,
    (SELECT value::numeric FROM public.system_settings WHERE key = 'hire_commission_percent'),
    7
  );
  v_commission := LEAST(100, GREATEST(0, v_commission));
  v_fee := ROUND(v_intent.amount * v_commission / 100, 2);
  v_net := ROUND(v_intent.amount - v_fee, 2);
  v_new_paid := ROUND(v_paid + v_intent.amount, 2);
  v_status := CASE WHEN v_new_paid >= v_total THEN 'paid' ELSE 'partial' END;

  INSERT INTO public.hire_payment_settlements (
    hire_quote_id, payment_intent_id, owner_user_id, gross_amount,
    platform_fee_amount, owner_net_amount, commission_percent, currency, mpesa_receipt
  ) VALUES (
    v_quote.id, v_intent.id, v_owner_id, v_intent.amount,
    v_fee, v_net, v_commission, COALESCE(v_quote.currency, 'KES'), p_mpesa_receipt
  );

  UPDATE public.hire_quotes
  SET payment_paid_total = v_new_paid,
      payment_status = v_status,
      payment_hold_expires_at = NULL
  WHERE id = v_quote.id;

  INSERT INTO public.hire_owner_balances (owner_user_id, gross_paid_total, platform_fee_total, owner_balance)
  VALUES (v_owner_id, v_intent.amount, v_fee, v_net)
  ON CONFLICT (owner_user_id) DO UPDATE SET
    gross_paid_total = public.hire_owner_balances.gross_paid_total + EXCLUDED.gross_paid_total,
    platform_fee_total = public.hire_owner_balances.platform_fee_total + EXCLUDED.platform_fee_total,
    owner_balance = public.hire_owner_balances.owner_balance + EXCLUDED.owner_balance,
    updated_at = now();

  RETURN jsonb_build_object(
    'hire_quote_id', v_quote.id,
    'owner_user_id', v_owner_id,
    'gross_amount', v_intent.amount,
    'platform_fee_amount', v_fee,
    'owner_net_amount', v_net,
    'commission_percent', v_commission,
    'payment_status', v_status,
    'paid_total', v_new_paid,
    'payment_threshold', v_quote.payment_minimum_amount
  );
END;
$$;
REVOKE ALL ON FUNCTION public.apply_hire_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hire_payment(uuid, text) TO service_role;

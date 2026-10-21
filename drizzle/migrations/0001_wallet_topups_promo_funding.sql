ALTER TABLE public.customer_wallet_entries ADD COLUMN IF NOT EXISTS refundable boolean NOT NULL DEFAULT true;
ALTER TABLE public.customer_wallet_entries ADD COLUMN IF NOT EXISTS hire_quote_id uuid;
ALTER TABLE public.customer_wallet_entries ADD COLUMN IF NOT EXISTS funding_batch_id uuid;
ALTER TABLE public.customer_wallet_entries DROP CONSTRAINT IF EXISTS customer_wallet_entries_kind_check;
ALTER TABLE public.customer_wallet_entries ADD CONSTRAINT customer_wallet_entries_kind_check CHECK (kind IN ('ride_credit','ride_payment','refund_payout','adjustment','wallet_topup','topup_bonus','admin_grant','hire_payment'));

DROP FUNCTION IF EXISTS public.customer_wallet_move(uuid, numeric, text, text, uuid, text, text, text);

-- Atomic, idempotent wallet movement with two pots:
--   cash (refundable)  : M-PESA top-ups and paid rides that found no driver
--   promo (non-refundable): admin grants and top-up bonuses; spend on rides/hire only
-- Spending burns promo first, then cash. Refunds can only draw cash.
CREATE OR REPLACE FUNCTION public.customer_wallet_move(p_user_id uuid, p_amount numeric, p_kind text, p_status text, p_ride_id uuid, p_note text, p_key text, p_phone text DEFAULT NULL, p_refundable boolean DEFAULT true, p_hire_quote_id uuid DEFAULT NULL, p_batch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cash numeric(12,2); v_promo numeric(12,2); v_id uuid; v_need numeric(12,2); v_promo_part numeric(12,2);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cwallet:' || p_user_id::text, 0));
  SELECT id INTO v_id FROM public.customer_wallet_entries WHERE idempotency_key = p_key;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('id', v_id, 'duplicate', true); END IF;
  SELECT COALESCE(SUM(amount) FILTER (WHERE refundable),0), COALESCE(SUM(amount) FILTER (WHERE NOT refundable),0)
    INTO v_cash, v_promo FROM public.customer_wallet_entries WHERE user_id = p_user_id AND status <> 'rejected';

  IF p_amount >= 0 THEN
    INSERT INTO public.customer_wallet_entries (user_id, amount, kind, status, ride_id, hire_quote_id, funding_batch_id, note, idempotency_key, payout_phone, refundable)
    VALUES (p_user_id, ROUND(p_amount,2), p_kind, p_status, p_ride_id, p_hire_quote_id, p_batch_id, p_note, p_key, p_phone, p_refundable) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'duplicate', false);
  END IF;

  v_need := ROUND(-p_amount, 2);
  IF p_kind = 'refund_payout' THEN
    IF v_cash < v_need THEN RAISE EXCEPTION 'Only KES % of your wallet can be refunded. Promo credit is for rides and car hire only.', v_cash; END IF;
    INSERT INTO public.customer_wallet_entries (user_id, amount, kind, status, note, idempotency_key, payout_phone, refundable)
    VALUES (p_user_id, -v_need, p_kind, p_status, p_note, p_key, p_phone, true) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'duplicate', false);
  END IF;

  IF p_kind NOT IN ('ride_payment','hire_payment','adjustment') THEN RAISE EXCEPTION 'Wallet money can only be spent on rides or car hire.'; END IF;
  IF v_cash + v_promo < v_need THEN RAISE EXCEPTION 'Your Twende wallet balance (KES %) is not enough.', v_cash + v_promo; END IF;
  v_promo_part := LEAST(GREATEST(v_promo,0), v_need);
  IF v_promo_part > 0 THEN
    INSERT INTO public.customer_wallet_entries (user_id, amount, kind, status, ride_id, hire_quote_id, note, idempotency_key, refundable)
    VALUES (p_user_id, -v_promo_part, p_kind, p_status, p_ride_id, p_hire_quote_id, p_note || ' (promo credit)', p_key || ':promo', false);
  END IF;
  INSERT INTO public.customer_wallet_entries (user_id, amount, kind, status, ride_id, hire_quote_id, note, idempotency_key, refundable)
  VALUES (p_user_id, -(v_need - v_promo_part), p_kind, p_status, p_ride_id, p_hire_quote_id, p_note, p_key, true) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'duplicate', false, 'promo_used', v_promo_part);
END $$;
REVOKE ALL ON FUNCTION public.customer_wallet_move(uuid, numeric, text, text, uuid, text, text, text, boolean, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_wallet_move(uuid, numeric, text, text, uuid, text, text, text, boolean, uuid, uuid) TO service_role;

CREATE TABLE public.wallet_funding_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  cohort text NOT NULL,
  user_ids uuid[] NOT NULL,
  amount_per_user numeric(12,2) NOT NULL CHECK (amount_per_user > 0 AND amount_per_user <= 5000),
  total_amount numeric(12,2) NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','awaiting_code','approved','failed','expired','cancelled')),
  approver_phone text NOT NULL,
  payment_intent_id uuid,
  mpesa_receipt text UNIQUE,
  code_hash text,
  code_expires_at timestamptz,
  code_attempts integer NOT NULL DEFAULT 0,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_funding_batches TO authenticated;
GRANT ALL ON public.wallet_funding_batches TO service_role;
ALTER TABLE public.wallet_funding_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance reads funding batches" ON public.wallet_funding_batches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'finance_admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE TRIGGER t_wallet_funding_batches_updated BEFORE UPDATE ON public.wallet_funding_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
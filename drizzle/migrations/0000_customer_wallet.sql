CREATE TABLE public.customer_wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ride_credit','ride_payment','refund_payout','adjustment')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','pending','paid','rejected')),
  ride_id uuid,
  note text,
  payout_phone text,
  payout_reference text,
  reviewed_by uuid,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_wallet_entries_user_idx ON public.customer_wallet_entries(user_id, created_at DESC);
GRANT SELECT ON public.customer_wallet_entries TO authenticated;
GRANT ALL ON public.customer_wallet_entries TO service_role;
ALTER TABLE public.customer_wallet_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers read own wallet" ON public.customer_wallet_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE TRIGGER t_customer_wallet_entries_updated BEFORE UPDATE ON public.customer_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Atomic wallet movement: locks the user's wallet so two taps can never spend the same money.
CREATE OR REPLACE FUNCTION public.customer_wallet_move(p_user_id uuid, p_amount numeric, p_kind text, p_status text, p_ride_id uuid, p_note text, p_key text, p_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_balance numeric(12,2); v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cwallet:' || p_user_id::text, 0));
  SELECT id INTO v_id FROM public.customer_wallet_entries WHERE idempotency_key = p_key;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('id', v_id, 'duplicate', true); END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_balance FROM public.customer_wallet_entries WHERE user_id = p_user_id AND status <> 'rejected';
  IF p_amount < 0 AND v_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'Your Twende wallet balance (KES %) is not enough.', v_balance;
  END IF;
  INSERT INTO public.customer_wallet_entries (user_id, amount, kind, status, ride_id, note, idempotency_key, payout_phone)
  VALUES (p_user_id, ROUND(p_amount,2), p_kind, p_status, p_ride_id, p_note, p_key, p_phone) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'duplicate', false, 'balance', v_balance + p_amount);
END $$;
REVOKE ALL ON FUNCTION public.customer_wallet_move(uuid, numeric, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_wallet_move(uuid, numeric, text, text, uuid, text, text, text) TO service_role;
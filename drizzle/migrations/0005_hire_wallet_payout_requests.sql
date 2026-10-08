ALTER TABLE public.hire_owner_balances
  ADD COLUMN IF NOT EXISTS paid_out_total numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.hire_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payout_phone text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'paid', 'rejected')),
  review_note text,
  payout_reference text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hire_payout_requests_owner_idx
  ON public.hire_payout_requests (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hire_payout_requests_review_idx
  ON public.hire_payout_requests (created_at ASC)
  WHERE status IN ('requested', 'approved');

ALTER TABLE public.hire_payout_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hire_payout_requests FROM anon, authenticated;
GRANT ALL ON public.hire_payout_requests TO service_role;

-- Requesting funds reserves them without reducing the owner balance. Pending and
-- approved requests are deducted from the amount the owner may request again.
CREATE OR REPLACE FUNCTION public.request_hire_payout(
  p_owner_user_id uuid,
  p_amount numeric,
  p_payout_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance public.hire_owner_balances%ROWTYPE;
  v_reserved numeric(12,2);
  v_available numeric(12,2);
  v_amount numeric(12,2);
  v_request_id uuid;
BEGIN
  v_amount := ROUND(p_amount, 2);
  IF p_owner_user_id IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter a payout amount greater than zero.';
  END IF;
  IF COALESCE(BTRIM(p_payout_phone), '') = '' THEN
    RAISE EXCEPTION 'Enter the M-Pesa number for this payout.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.vehicles v
    WHERE v.owner_driver_id = p_owner_user_id
       OR EXISTS (
         SELECT 1 FROM public.fleets f
         WHERE f.id = v.fleet_id AND f.owner_id = p_owner_user_id
       )
  ) THEN
    RAISE EXCEPTION 'Only a hire vehicle owner can request a hire payout.';
  END IF;

  SELECT * INTO v_balance
  FROM public.hire_owner_balances
  WHERE owner_user_id = p_owner_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no hire wallet balance available for payout.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_reserved
  FROM public.hire_payout_requests
  WHERE owner_user_id = p_owner_user_id AND status IN ('requested', 'approved');
  v_available := GREATEST(0, v_balance.owner_balance - v_reserved);
  IF v_amount > v_available THEN
    RAISE EXCEPTION 'Payout exceeds your available hire balance of KES %.', TO_CHAR(v_available, 'FM999999999999990.00');
  END IF;

  INSERT INTO public.hire_payout_requests (owner_user_id, amount, payout_phone)
  VALUES (p_owner_user_id, v_amount, BTRIM(p_payout_phone))
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'amount', v_amount,
    'reserved_total', v_reserved + v_amount,
    'available_balance', v_available - v_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_hire_payout(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_hire_payout(uuid, numeric, text) TO service_role;

-- A finance review is serialized against both the payout request and owner
-- balance. Marking a request paid atomically debits the hire wallet exactly once.
CREATE OR REPLACE FUNCTION public.review_hire_payout_request(
  p_request_id uuid,
  p_decision text,
  p_reviewer_id uuid,
  p_note text DEFAULT NULL,
  p_payout_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.hire_payout_requests%ROWTYPE;
  v_balance public.hire_owner_balances%ROWTYPE;
  v_reference text;
BEGIN
  IF p_decision NOT IN ('approved', 'paid', 'rejected') THEN
    RAISE EXCEPTION 'Choose approve, mark paid, or reject.';
  END IF;

  SELECT * INTO v_request
  FROM public.hire_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hire payout request not found.';
  END IF;
  IF v_request.status = p_decision THEN
    RETURN jsonb_build_object(
      'request_id', v_request.id,
      'owner_user_id', v_request.owner_user_id,
      'amount', v_request.amount,
      'status', v_request.status,
      'payout_reference', v_request.payout_reference,
      'already_applied', true
    );
  END IF;
  IF v_request.status NOT IN ('requested', 'approved') THEN
    RAISE EXCEPTION 'This hire payout request is already closed.';
  END IF;

  IF p_decision = 'approved' THEN
    IF v_request.status <> 'requested' THEN
      RAISE EXCEPTION 'Only a new hire payout request can be approved.';
    END IF;
    UPDATE public.hire_payout_requests
    SET status = 'approved',
        review_note = NULLIF(BTRIM(p_note), ''),
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        updated_at = now()
    WHERE id = v_request.id;
  ELSIF p_decision = 'rejected' THEN
    UPDATE public.hire_payout_requests
    SET status = 'rejected',
        review_note = NULLIF(BTRIM(p_note), ''),
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        updated_at = now()
    WHERE id = v_request.id;
  ELSE
    IF v_request.status <> 'approved' THEN
      RAISE EXCEPTION 'Approve this hire payout request before marking it paid.';
    END IF;
    v_reference := NULLIF(BTRIM(p_payout_reference), '');
    IF v_reference IS NULL THEN
      RAISE EXCEPTION 'Record the M-Pesa receipt or payout reference before marking this request paid.';
    END IF;

    SELECT * INTO v_balance
    FROM public.hire_owner_balances
    WHERE owner_user_id = v_request.owner_user_id
    FOR UPDATE;
    IF NOT FOUND OR v_balance.owner_balance < v_request.amount THEN
      RAISE EXCEPTION 'The hire wallet balance is no longer sufficient for this payout.';
    END IF;

    UPDATE public.hire_owner_balances
    SET owner_balance = owner_balance - v_request.amount,
        paid_out_total = paid_out_total + v_request.amount,
        updated_at = now()
    WHERE owner_user_id = v_request.owner_user_id;

    UPDATE public.hire_payout_requests
    SET status = 'paid',
        review_note = NULLIF(BTRIM(p_note), ''),
        payout_reference = v_reference,
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        paid_at = now(),
        updated_at = now()
    WHERE id = v_request.id;
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'owner_user_id', v_request.owner_user_id,
    'amount', v_request.amount,
    'status', p_decision,
    'payout_reference', CASE WHEN p_decision = 'paid' THEN v_reference ELSE NULL END,
    'already_applied', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_hire_payout_request(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_hire_payout_request(uuid, text, uuid, text, text) TO service_role;

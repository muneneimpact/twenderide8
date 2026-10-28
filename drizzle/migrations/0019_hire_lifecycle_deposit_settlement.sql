-- Phase 2: explicit hire lifecycle, append-only events, and deposit settlement intents.
ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'submitted';

ALTER TABLE public.hire_quotes
  DROP CONSTRAINT IF EXISTS hire_quotes_lifecycle_state_check;
ALTER TABLE public.hire_quotes
  ADD CONSTRAINT hire_quotes_lifecycle_state_check CHECK (
    lifecycle_state IN (
      'submitted', 'quoted', 'payment_pending', 'confirmed',
      'ready_for_handover', 'on_hire', 'return_pending',
      'settlement_pending', 'closed', 'declined', 'cancelled'
    )
  );

-- Backfill the state from the existing timestamp/status fields.
UPDATE public.hire_quotes
SET lifecycle_state = CASE
  WHEN returned_at IS NOT NULL THEN 'closed'
  WHEN handed_over_at IS NOT NULL THEN 'on_hire'
  WHEN status = 'declined' THEN 'declined'
  WHEN status = 'confirmed' THEN 'ready_for_handover'
  WHEN status = 'quoted' THEN 'quoted'
  WHEN vehicle_id IS NOT NULL AND payment_status IN ('pending', 'failed', 'timed_out') THEN 'payment_pending'
  ELSE 'submitted'
END;

CREATE INDEX IF NOT EXISTS hire_quotes_lifecycle_state_idx
  ON public.hire_quotes (lifecycle_state, start_at);

CREATE TABLE IF NOT EXISTS public.hire_quote_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hire_quote_id uuid NOT NULL REFERENCES public.hire_quotes(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  event_type text NOT NULL,
  actor_id uuid,
  actor_role text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hire_quote_events_quote_created_idx
  ON public.hire_quote_events (hire_quote_id, created_at DESC);
GRANT ALL ON public.hire_quote_events TO service_role;
ALTER TABLE public.hire_quote_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.hire_deposit_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hire_quote_id uuid NOT NULL UNIQUE REFERENCES public.hire_quotes(id) ON DELETE CASCADE,
  requested_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
  held_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (held_amount >= 0),
  retained_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (retained_amount >= 0),
  returned_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (returned_amount >= 0),
  balance_due numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  status text NOT NULL DEFAULT 'not_requested' CHECK (
    status IN ('not_requested', 'requested', 'held', 'settlement_pending', 'returned', 'retained', 'disputed', 'balance_due')
  ),
  requested_at timestamptz,
  held_at timestamptz,
  settled_at timestamptz,
  settled_by uuid,
  dispute_reason text,
  settlement_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hire_deposit_settlement_split_valid CHECK (
    retained_amount + returned_amount <= held_amount
  )
);
CREATE INDEX IF NOT EXISTS hire_deposit_settlements_status_idx
  ON public.hire_deposit_settlements (status, updated_at DESC);
GRANT ALL ON public.hire_deposit_settlements TO service_role;
ALTER TABLE public.hire_deposit_settlements ENABLE ROW LEVEL SECURITY;

-- Establish a baseline event for existing bookings without rewriting their history.
INSERT INTO public.hire_quote_events (hire_quote_id, to_state, event_type, actor_role, reason, metadata)
SELECT q.id, q.lifecycle_state, 'lifecycle_backfill', 'system', 'Initial lifecycle state backfilled from existing booking fields', '{}'::jsonb
FROM public.hire_quotes q
WHERE NOT EXISTS (
  SELECT 1 FROM public.hire_quote_events e WHERE e.hire_quote_id = q.id
);

-- Existing handover-deposit bookings have a known requested amount even if no
-- settlement row was created by the old flow.
INSERT INTO public.hire_deposit_settlements (hire_quote_id, requested_amount, status, requested_at)
SELECT q.id, GREATEST(COALESCE(q.deposit_amount, 0), 0),
  CASE WHEN q.deposit_requested_at IS NULL THEN 'not_requested' ELSE 'requested' END,
  q.deposit_requested_at
FROM public.hire_quotes q
WHERE q.deposit_policy = 'handover'
  AND COALESCE(q.deposit_amount, 0) > 0
ON CONFLICT (hire_quote_id) DO NOTHING;

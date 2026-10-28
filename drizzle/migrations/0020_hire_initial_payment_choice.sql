ALTER TABLE public.hire_quotes
  ADD COLUMN IF NOT EXISTS initial_payment_choice text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hire_quotes_initial_payment_choice_check'
      AND conrelid = 'public.hire_quotes'::regclass
  ) THEN
    ALTER TABLE public.hire_quotes
      ADD CONSTRAINT hire_quotes_initial_payment_choice_check
      CHECK (initial_payment_choice IS NULL OR initial_payment_choice IN ('full', 'one_day'));
  END IF;
END $$;

COMMENT ON COLUMN public.hire_quotes.initial_payment_choice IS
  'Customer-selected first-payment option for a flexible daily hire; null for legacy or pay-later quotes.';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS insurance_provider text,
  ADD COLUMN IF NOT EXISTS insurance_policy_number text,
  ADD COLUMN IF NOT EXISTS insurance_coverage_details text;

COMMENT ON COLUMN public.documents.insurance_provider IS 'Private provider or agency named on the vehicle insurance document.';
COMMENT ON COLUMN public.documents.insurance_policy_number IS 'Private policy number; stored on the associated private compliance document.';
COMMENT ON COLUMN public.documents.insurance_coverage_details IS 'Private coverage details entered with the vehicle insurance document.';

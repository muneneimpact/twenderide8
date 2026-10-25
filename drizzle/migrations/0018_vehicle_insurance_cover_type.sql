ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS insurance_cover_type text;

COMMENT ON COLUMN public.documents.insurance_cover_type IS
  'Owner-selected category for a vehicle insurance policy; private compliance metadata.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_state') THEN
    CREATE TYPE public.approval_state AS ENUM ('pending','approved','rejected','restricted');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  applies_to text NOT NULL CHECK (applies_to = ANY (ARRAY['driver','fleet','vehicle','customer','owner'])),
  required boolean NOT NULL DEFAULT true,
  expires boolean NOT NULL DEFAULT true,
  reminder_days integer NOT NULL DEFAULT 14,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  requires_image boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_id uuid NOT NULL REFERENCES public.document_types(id) ON DELETE RESTRICT,
  subject_user_id uuid,
  subject_fleet_id uuid REFERENCES public.fleets(id) ON DELETE CASCADE,
  subject_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  file_path text,
  reference text,
  issued_on date,
  expires_on date,
  status public.approval_state NOT NULL DEFAULT 'pending',
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expiry_reminders_sent text[] NOT NULL DEFAULT '{}'
);

GRANT SELECT ON public.document_types TO authenticated;
GRANT ALL ON public.document_types TO service_role;
GRANT SELECT, INSERT ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='document_types' AND policyname='document_types_read') THEN
    CREATE POLICY document_types_read ON public.document_types FOR SELECT TO authenticated USING (active OR public.is_staff(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='documents' AND policyname='documents_read') THEN
    CREATE POLICY documents_read ON public.documents FOR SELECT TO authenticated USING (subject_user_id = auth.uid() OR public.is_staff(auth.uid()) OR (subject_fleet_id IS NOT NULL AND public.owns_fleet(auth.uid(), subject_fleet_id)) OR (subject_vehicle_id IS NOT NULL AND public.owns_vehicle(auth.uid(), subject_vehicle_id)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='documents' AND policyname='documents_insert') THEN
    CREATE POLICY documents_insert ON public.documents FOR INSERT TO authenticated WITH CHECK (subject_user_id = auth.uid() OR (subject_fleet_id IS NOT NULL AND public.owns_fleet(auth.uid(), subject_fleet_id)) OR (subject_vehicle_id IS NOT NULL AND public.owns_vehicle(auth.uid(), subject_vehicle_id)));
  END IF;
END $$;

INSERT INTO public.document_types (code, label, applies_to, required, expires, reminder_days, active, requires_image) VALUES
 ('national_id','National ID / Passport','driver',true,false,14,true,true),
 ('driving_licence','Driving licence','driver',true,true,14,true,true),
 ('psv_licence','PSV badge / licence','driver',true,true,14,true,true),
 ('good_conduct','Certificate of good conduct','driver',true,true,14,true,true),
 ('driver_kra_pin','KRA PIN certificate','driver',false,false,14,true,true),
 ('vehicle_logbook','Vehicle logbook','vehicle',true,false,14,true,true),
 ('vehicle_insurance','Commercial (PSV) insurance','vehicle',true,true,14,true,true),
 ('ntsa_inspection','NTSA inspection certificate','vehicle',true,true,14,true,true),
 ('psv_vehicle_licence','PSV vehicle licence','vehicle',true,true,14,true,true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.document_types (code, label, applies_to, required, expires, reminder_days, active, requires_image) VALUES
 ('driving_licence','Driving licence','driver',true,true,30,true,true),
 ('national_id','National ID','driver',true,false,0,true,true),
 ('psv_badge','PSV badge','driver',false,true,30,true,true),
 ('good_conduct','Certificate of good conduct','driver',false,true,30,true,true),
 ('logbook','Logbook','vehicle',true,false,0,true,true),
 ('insurance','Insurance certificate','vehicle',true,true,14,true,true),
 ('inspection','Inspection certificate','vehicle',true,true,30,true,true),
 ('ntsa_psv_licence','NTSA PSV licence','vehicle',false,true,30,true,true)
ON CONFLICT (code) DO NOTHING;
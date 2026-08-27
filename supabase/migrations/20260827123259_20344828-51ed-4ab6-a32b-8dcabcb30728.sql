insert into public.document_types (code, label, applies_to, required, expires, reminder_days, active, requires_image) values
('national_id','National ID','driver',true,false,14,true,true),
('driving_licence','Driving licence','driver',true,true,30,true,true),
('good_conduct','Certificate of good conduct','driver',true,true,30,true,true),
('psv_badge','PSV badge','driver',false,true,30,true,true),
('driver_photo','Passport photo','driver',true,false,14,true,true),
('vehicle_logbook','Vehicle logbook','vehicle',true,false,14,true,true),
('vehicle_insurance','Insurance certificate','vehicle',true,true,30,true,true),
('vehicle_inspection','Inspection certificate','vehicle',false,true,30,true,true)
on conflict (code) do update set label = excluded.label, applies_to = excluded.applies_to, required = excluded.required, expires = excluded.expires, requires_image = excluded.requires_image, active = true;
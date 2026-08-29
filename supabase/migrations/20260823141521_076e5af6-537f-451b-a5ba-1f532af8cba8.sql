CREATE POLICY "Drivers manage their own document images"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Staff can read driver document images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'driver-documents' AND public.is_staff(auth.uid()));
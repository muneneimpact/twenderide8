
CREATE POLICY "vehicle photos owner write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'vehicle-photos' AND owner = auth.uid());

CREATE POLICY "vehicle photos owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'vehicle-photos' AND (owner = auth.uid() OR public.is_staff(auth.uid())))
WITH CHECK (bucket_id = 'vehicle-photos' AND (owner = auth.uid() OR public.is_staff(auth.uid())));

CREATE POLICY "vehicle photos owner read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'vehicle-photos' AND (owner = auth.uid() OR public.is_staff(auth.uid())));

CREATE POLICY "vehicle photos owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'vehicle-photos' AND (owner = auth.uid() OR public.is_staff(auth.uid())));
